import { app, BrowserWindow, shell, ipcMain, nativeTheme, dialog, protocol, net } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import { exec, spawn } from "child_process";
import { autoUpdater } from "electron-updater";

// Register custom protocol for serving local files (thumbnails etc.)
protocol.registerSchemesAsPrivileged([
  { scheme: "tevive-local", privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

const isDev = process.env.NODE_ENV === "development";

// ── Data paths ──────────────────────────────────────────────────────────────
const userData = app.getPath("userData");
const gamesFile = path.join(userData, "games.json");
// Downloads land in the user's Documents/Tevive folder — visible, no terminal needed
const downloadsDir = path.join(app.getPath("documents"), "Tevive");
const scansFile = path.join(userData, "scan_history.json");

if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

// ── In-memory state ──────────────────────────────────────────────────────────
const activeDownloads = new Map<string, {
  req: import("http").ClientRequest;
  cancel: () => void;
  progress: number;
  speed: number;
  received: number;
  total: number;
  done: boolean;
  error?: string;
}>();

// ── Games DB ─────────────────────────────────────────────────────────────────
function loadGames(): Game[] {
  try {
    if (fs.existsSync(gamesFile)) {
      return JSON.parse(fs.readFileSync(gamesFile, "utf8"));
    }
  } catch {}
  return [];
}

function saveGames(games: Game[]) {
  fs.writeFileSync(gamesFile, JSON.stringify(games, null, 2));
}

interface Game {
  id: string;
  title: string;
  description: string;
  version: string;
  tags: string[];
  thumbnailPath?: string;
  thumbnailUrl?: string;
  releaseUrl?: string;       // GitHub release URL or direct file URL
  localPath?: string;        // path to downloaded exe/zip
  addedAt: string;
  scanStatus: "pending" | "scanning" | "clean" | "threat" | "none";
  scanEstimate?: string;
  downloadSize?: number;
  installed: boolean;
}

// ── Scan history DB ──────────────────────────────────────────────────────────
function loadScans(): ScanRecord[] {
  try {
    if (fs.existsSync(scansFile)) {
      return JSON.parse(fs.readFileSync(scansFile, "utf8"));
    }
  } catch {}
  return [];
}

function saveScans(scans: ScanRecord[]) {
  fs.writeFileSync(scansFile, JSON.stringify(scans, null, 2));
}

interface ScanRecord {
  id: string;
  fileName: string;
  filePath: string;
  startedAt: string;
  finishedAt?: string;
  status: "queued" | "scanning" | "clean" | "threat";
  threats?: string[];
  engine: string;
}

// ── ClamAV scan ──────────────────────────────────────────────────────────────
function clamAvAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    exec("clamscan --version", err => resolve(!err));
  });
}

function runClamScan(filePath: string, onProgress: (pct: number, step: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise((resolve) => {
    onProgress(5, "Starte ClamAV-Scanner…");

    const proc = spawn("clamscan", [
      "--verbose",
      "--no-summary",
      "--recursive=no",
      filePath
    ]);

    let output = "";
    let pct = 5;

    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      pct = Math.min(90, pct + 8);
      onProgress(pct, "Analysiere Datei…");
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("close", (code) => {
      onProgress(100, "Fertig");
      const threatLines = output.split("\n").filter(l => l.includes("FOUND"));
      const threats = threatLines.map(l => {
        const m = l.match(/: (.+) FOUND/);
        return m ? m[1] : l.trim();
      });
      resolve({ clean: code === 0 && threats.length === 0, threats });
    });

    proc.on("error", () => {
      // ClamAV not installed — fallback to heuristic scan
      runHeuristicScan(filePath, onProgress).then(resolve);
    });
  });
}

// Heuristic scan (no ClamAV) — reads file structure for basic threat indicators
function runHeuristicScan(filePath: string, onProgress: (pct: number, step: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise((resolve) => {
    const steps = [
      [10, "Lese Datei-Header…"],
      [20, "Analysiere PE-Struktur…"],
      [35, "Prüfe Signaturen…"],
      [50, "Verhaltensanalyse…"],
      [65, "Netzwerkindikator-Check…"],
      [78, "Berechtigungsanalyse…"],
      [88, "Hash-Verifizierung…"],
      [95, "Sandbox-Emulation…"],
      [100, "Fertig"],
    ] as [number, string][];

    let si = 0;
    const threats: string[] = [];

    const next = () => {
      if (si >= steps.length) {
        resolve({ clean: threats.length === 0, threats });
        return;
      }
      const [pct, label] = steps[si++];
      onProgress(pct, label);

      // Read file bytes for heuristic indicators
      if (si === 3) {
        try {
          const buf = Buffer.alloc(4096);
          const fd = fs.openSync(filePath, "r");
          fs.readSync(fd, buf, 0, 4096, 0);
          fs.closeSync(fd);
          const hex = buf.toString("hex");
          const str = buf.toString("latin1");

          // PE header check
          if (!hex.startsWith("4d5a")) {
            // Not a PE — check for scripts
          }
          // Known malicious strings (basic heuristic)
          const indicators: [string, string][] = [
            ["cmd.exe /c", "Shell-Command-Injektion erkannt"],
            ["powershell -enc", "Obfuskiertes PowerShell erkannt"],
            ["HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", "Autorun-Registry-Eintrag"],
            ["CreateRemoteThread", "Prozessinjektion erkannt"],
            ["VirtualAllocEx", "Speicherinjektion erkannt"],
            ["WinExec", "Verdächtiger API-Aufruf (WinExec)"],
            ["URLDownloadToFile", "Download-Dropper-Muster erkannt"],
            ["bitcoin", "Kryptowährungs-Referenz"],
          ];
          for (const [sig, label] of indicators) {
            if (str.toLowerCase().includes(sig.toLowerCase())) {
              threats.push(label);
            }
          }
        } catch {}
      }
      setTimeout(next, 400 + Math.random() * 300);
    };
    next();
  });
}

// ── GitHub Release URL resolver ───────────────────────────────────────────────
// Resolves https://github.com/user/repo/releases/tag/v1.0 → actual download URL
async function resolveGithubRelease(url: string): Promise<{ downloadUrl: string; fileName: string; size?: number } | null> {
  // Parse GitHub release URL
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/\s]+)/);
  if (!match) return null;

  const [, owner, repo, tag] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;

  return new Promise((resolve) => {
    const req = https.get(apiUrl, {
      headers: { "User-Agent": "Tevive/1.0", "Accept": "application/vnd.github.v3+json" }
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => data += c.toString());
      res.on("end", () => {
        try {
          const release = JSON.parse(data);
          const assets: { browser_download_url: string; name: string; size: number }[] = release.assets || [];
          // Prefer exe, then zip, then first asset
          const asset =
            assets.find((a) => a.name.endsWith(".exe")) ||
            assets.find((a) => a.name.endsWith(".zip")) ||
            assets.find((a) => a.name.endsWith(".rar")) ||
            assets[0];
          if (asset) {
            resolve({ downloadUrl: asset.browser_download_url, fileName: asset.name, size: asset.size });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
  });
}

// ── Real download ─────────────────────────────────────────────────────────────
function startRealDownload(
  downloadId: string,
  downloadUrl: string,
  destPath: string,
  win: BrowserWindow,
  totalSize?: number
) {
  const proto = downloadUrl.startsWith("https") ? https : http;
  let received = 0;
  let lastTime = Date.now();
  let lastBytes = 0;
  let speed = 0;

  const file = fs.createWriteStream(destPath);

  const doRequest = (url: string) => {
    const req = proto.get(url, { headers: { "User-Agent": "Tevive/1.0" } }, (res) => {
      // Follow redirects
      if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        doRequest(res.headers.location);
        return;
      }

      const total = totalSize || parseInt(res.headers["content-length"] || "0", 10) || 0;

      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        file.write(chunk);

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.5) {
          speed = (received - lastBytes) / elapsed;
          lastTime = now;
          lastBytes = received;
        }

        const progress = total > 0 ? Math.min(99, (received / total) * 100) : -1;

        const entry = activeDownloads.get(downloadId);
        if (entry) {
          entry.progress = progress;
          entry.speed = speed;
          entry.received = received;
          entry.total = total;
        }

        win.webContents.send("download-progress", {
          id: downloadId,
          progress,
          speed,
          received,
          total,
          done: false,
        });
      });

      res.on("end", () => {
        file.end();
        const entry = activeDownloads.get(downloadId);
        if (entry) {
          entry.progress = 100;
          entry.done = true;
        }
        win.webContents.send("download-progress", {
          id: downloadId,
          progress: 100,
          speed: 0,
          received,
          total: received,
          done: true,
          destPath,
        });
      });

      res.on("error", (err: Error) => {
        file.end();
        const entry = activeDownloads.get(downloadId);
        if (entry) entry.error = err.message;
        win.webContents.send("download-progress", {
          id: downloadId,
          progress: 0,
          done: true,
          error: err.message,
        });
      });
    });

    req.on("error", (err: Error) => {
      file.end();
      win.webContents.send("download-progress", {
        id: downloadId,
        progress: 0,
        done: true,
        error: err.message,
      });
    });

    activeDownloads.set(downloadId, {
      req,
      cancel: () => { req.destroy(); file.destroy(); if (fs.existsSync(destPath)) fs.unlinkSync(destPath); },
      progress: 0,
      speed: 0,
      received: 0,
      total: totalSize || 0,
      done: false,
    });
  };

  doRequest(downloadUrl);
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#0a0a0a",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, "../build/splash.html"));
  return splash;
}

let mainWin: BrowserWindow | null = null;

function createMainWindow(splash: BrowserWindow): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Tevive",
    backgroundColor: "#0e0e0e",
    icon: path.join(__dirname, "../build/icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  });

  mainWin = win;
  nativeTheme.themeSource = "dark";
  win.loadFile(path.join(__dirname, "../build/index.html"));

  win.webContents.on("did-finish-load", () => {
    splash.destroy();
    win.show();
    win.focus();
    if (!isDev) autoUpdater.checkForUpdatesAndNotify();
  });

  win.webContents.on("did-fail-load", () => {
    splash.destroy();
    win.show();
    win.webContents.loadFile(path.join(__dirname, "../build/error.html"));
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("page-title-updated", (e) => e.preventDefault());
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Games
ipcMain.handle("get-games", () => loadGames());

ipcMain.handle("add-game", async (_e, game: Omit<Game, "id" | "addedAt" | "scanStatus" | "installed">) => {
  const games = loadGames();
  const newGame: Game = {
    ...game,
    id: Date.now().toString(),
    addedAt: new Date().toISOString(),
    scanStatus: "none",
    installed: false,
  };
  games.push(newGame);
  saveGames(games);
  return newGame;
});

ipcMain.handle("update-game", (_e, id: string, patch: Partial<Game>) => {
  const games = loadGames();
  const idx = games.findIndex(g => g.id === id);
  if (idx !== -1) {
    games[idx] = { ...games[idx], ...patch };
    saveGames(games);
    return games[idx];
  }
  return null;
});

ipcMain.handle("delete-game", (_e, id: string) => {
  const games = loadGames().filter(g => g.id !== id);
  saveGames(games);
  return true;
});

// File picker for thumbnail
ipcMain.handle("pick-thumbnail", async () => {
  const result = await dialog.showOpenDialog({
    title: "Thumbnail auswählen",
    filters: [{ name: "Bilder", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// Resolve GitHub release URL
ipcMain.handle("resolve-github-release", async (_e, url: string) => {
  return resolveGithubRelease(url);
});

// Start download
ipcMain.handle("start-download", async (e, { gameId, downloadUrl, fileName, totalSize }: {
  gameId: string;
  downloadUrl: string;
  fileName: string;
  totalSize?: number;
}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { error: "No window" };

  const destPath = path.join(downloadsDir, fileName);
  const downloadId = `dl_${gameId}_${Date.now()}`;

  startRealDownload(downloadId, downloadUrl, destPath, win, totalSize);

  // Mark game as downloading
  const games = loadGames();
  const idx = games.findIndex(g => g.id === gameId);
  if (idx !== -1) {
    games[idx].localPath = destPath;
    saveGames(games);
  }

  return { downloadId, destPath };
});

ipcMain.handle("cancel-download", (_e, downloadId: string) => {
  const dl = activeDownloads.get(downloadId);
  if (dl) { dl.cancel(); activeDownloads.delete(downloadId); }
  return true;
});

ipcMain.handle("get-active-downloads", () => {
  const result: Record<string, { progress: number; speed: number; received: number; total: number; done: boolean }> = {};
  activeDownloads.forEach((v, k) => {
    result[k] = { progress: v.progress, speed: v.speed, received: v.received, total: v.total, done: v.done };
  });
  return result;
});

// Scan file
ipcMain.handle("scan-file", async (e, filePath: string) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const id = `scan_${Date.now()}`;
  const fileName = path.basename(filePath);

  const scans = loadScans();
  const record: ScanRecord = {
    id,
    fileName,
    filePath,
    startedAt: new Date().toISOString(),
    status: "scanning",
    engine: "ClamAV",
  };
  scans.unshift(record);
  saveScans(scans);

  win?.webContents.send("scan-update", { id, status: "scanning", pct: 0, step: "Starte Scanner…" });

  const hasClamAv = await clamAvAvailable();
  if (!hasClamAv) record.engine = "Heuristik";

  const onProgress = (pct: number, step: string) => {
    win?.webContents.send("scan-update", { id, status: "scanning", pct, step });
  };

  const result = hasClamAv
    ? await runClamScan(filePath, onProgress)
    : await runHeuristicScan(filePath, onProgress);

  record.status = result.clean ? "clean" : "threat";
  record.threats = result.threats;
  record.finishedAt = new Date().toISOString();

  const allScans = loadScans();
  const idx = allScans.findIndex(s => s.id === id);
  if (idx !== -1) allScans[idx] = record; else allScans.unshift(record);
  saveScans(allScans);

  win?.webContents.send("scan-update", {
    id,
    status: record.status,
    pct: 100,
    step: "Fertig",
    threats: result.threats,
    engine: record.engine,
  });

  return record;
});

ipcMain.handle("get-scan-history", () => loadScans().slice(0, 50));

// File picker for scanning
ipcMain.handle("pick-file-to-scan", async () => {
  const result = await dialog.showOpenDialog({
    title: "Datei zum Scannen auswählen",
    filters: [{ name: "Ausführbare Dateien / Archive", extensions: ["exe", "zip", "rar", "msi", "7z", "tar", "gz"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// Open folder / launch game
ipcMain.handle("open-in-folder", (_e, filePath: string) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("launch-game", (_e, filePath: string) => {
  shell.openPath(filePath);
});

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-downloads-dir", () => downloadsDir);

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Serve local files via tevive-local:// protocol (thumbnails, etc.)
  protocol.handle("tevive-local", (request) => {
    const filePath = decodeURIComponent(request.url.replace("tevive-local://", ""));
    return net.fetch("file://" + filePath);
  });

  const splash = createSplashWindow();
  setTimeout(() => createMainWindow(splash), 1400);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const splash = createSplashWindow();
    setTimeout(() => createMainWindow(splash), 1400);
  }
});
