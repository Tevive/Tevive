import { app, BrowserWindow, shell, ipcMain, nativeTheme, dialog, protocol, net } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import crypto from "crypto";
import { exec, spawn } from "child_process";
import { autoUpdater } from "electron-updater";

protocol.registerSchemesAsPrivileged([
  { scheme: "tevive-local", privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

const isDev = process.env.NODE_ENV === "development";

// ── Paths ─────────────────────────────────────────────────────────────────────
const userData = app.getPath("userData");
const gamesFile    = path.join(userData, "games.json");
const usersFile    = path.join(userData, "users.json");
const settingsFile = path.join(userData, "settings.json");
const scansFile    = path.join(userData, "scan_history.json");

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ── Settings ──────────────────────────────────────────────────────────────────
interface Settings {
  downloadDir: string;
  theme: "dark" | "darker";
  autoScanOnUpload: boolean;
  language: string;
}
function defaultSettings(): Settings {
  return {
    downloadDir: path.join(app.getPath("documents"), "Tevive"),
    theme: "darker",
    autoScanOnUpload: true,
    language: "de",
  };
}
function loadSettings(): Settings {
  try { if (fs.existsSync(settingsFile)) return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; }
  catch {}
  return defaultSettings();
}
function saveSettings(s: Settings) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }

// ── Users ─────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  avatarColor: string;
}
function hashPw(pw: string): string {
  return crypto.createHash("sha256").update(pw + "tevive_salt_2026").digest("hex");
}
function loadUsers(): User[] {
  try { if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, "utf8")); } catch {}
  return [];
}
function saveUsers(u: User[]) { fs.writeFileSync(usersFile, JSON.stringify(u, null, 2)); }

// ── Games ─────────────────────────────────────────────────────────────────────
interface Game {
  id: string;
  title: string;
  description: string;
  version: string;
  tags: string[];
  thumbnailPath?: string;
  releaseUrl?: string;
  localPath?: string;
  addedAt: string;
  uploadedBy?: string;
  scanStatus: "pending" | "scanning" | "clean" | "threat" | "none";
  scanEngine?: string;
  threats?: string[];
  downloadSize?: number;
  installed: boolean;
  published: boolean;
}
function loadGames(): Game[] {
  try { if (fs.existsSync(gamesFile)) return JSON.parse(fs.readFileSync(gamesFile, "utf8")); } catch {}
  return [];
}
function saveGames(g: Game[]) { fs.writeFileSync(gamesFile, JSON.stringify(g, null, 2)); }

// ── Scan history ──────────────────────────────────────────────────────────────
interface ScanRecord {
  id: string; fileName: string; filePath: string;
  startedAt: string; finishedAt?: string;
  status: "scanning" | "clean" | "threat";
  threats?: string[]; engine: string; gameId?: string;
}
function loadScans(): ScanRecord[] {
  try { if (fs.existsSync(scansFile)) return JSON.parse(fs.readFileSync(scansFile, "utf8")); } catch {}
  return [];
}
function saveScans(s: ScanRecord[]) { fs.writeFileSync(scansFile, JSON.stringify(s, null, 2)); }

// ── ClamAV availability ───────────────────────────────────────────────────────
function clamAvAvailable(): Promise<boolean> {
  return new Promise(r => exec("clamscan --version", err => r(!err)));
}

// ── Heuristic scan ────────────────────────────────────────────────────────────
function runHeuristicScan(
  filePath: string,
  onProgress: (pct: number, step: string, checkId: string) => void
): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    const INDICATORS: [string, string][] = [
      ["cmd.exe /c", "Trojaner: Shell-Command-Injektion"],
      ["powershell -enc", "Trojaner: Obfuskiertes PowerShell"],
      ["powershell -e ", "Trojaner: Encoded PowerShell Command"],
      ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", "Trojaner: Autorun-Registry"],
      ["CreateRemoteThread", "Rootkit/Trojaner: Prozessinjektion"],
      ["VirtualAllocEx", "Rootkit: Speicherinjektion"],
      ["WriteProcessMemory", "Rootkit: Remote Memory Write"],
      ["WinExec", "Trojaner: WinExec API Call"],
      ["URLDownloadToFile", "Trojaner: Download Dropper"],
      ["bitsadmin", "Trojaner: BITS Abuse"],
      ["bitcoin", "Cryptojacker: Kryptowährungs-Referenz"],
      ["monero", "Cryptojacker: Monero-Mining"],
      ["xmrig", "Cryptojacker: XMRig Miner"],
      ["CryptoLocker", "Ransomware: CryptoLocker Signatur"],
      ["YOUR_FILES_ARE_ENCRYPTED", "Ransomware: Verschlüsselungs-Nachricht"],
      ["RANSOM", "Ransomware: Lösegeld-Indikator"],
      ["keylogger", "Spyware: Keylogger Referenz"],
      ["GetAsyncKeyState", "Spyware: Tastatureingabe-Überwachung"],
      ["SetWindowsHookEx", "Spyware: Hook-Installation"],
      ["adware", "Adware: Werbesoftware"],
      ["inject_ad", "Adware: Ad-Injektion"],
      ["botnet", "Bot/Botnet: Netzwerk-Bot"],
      ["IRC_CONNECT", "Bot/Botnet: IRC Bot Verbindung"],
      ["ZeroAccess", "Rootkit: ZeroAccess Signatur"],
      ["Rustock", "Rootkit: Rustock Signatur"],
      ["MBR_WIPER", "Wiper: MBR-Überschreibung"],
      ["disk_wipe", "Wiper: Disk-Wipe Funktion"],
    ];

    const STEPS: [number, string, string][] = [
      [8,  "Lese PE-Header…",           "pe"],
      [20, "Signatur-Analyse…",          "sig"],
      [33, "Verhaltensanalyse…",         "behav"],
      [46, "Heuristik-Scan…",            "heur"],
      [58, "Netzwerk-Indikatoren…",      "net"],
      [68, "Berechtigungsanalyse…",      "perm"],
      [80, "Hash-Verifizierung…",        "hash"],
      [90, "Ransomware-Patterns…",       "ransom"],
      [95, "Rootkit/Wiper-Analyse…",     "rootkit"],
      [100,"Fertig",                      "done"],
    ];

    const threats: string[] = [];
    let si = 0;

    const next = () => {
      if (si >= STEPS.length) { resolve({ clean: threats.length === 0, threats }); return; }
      const [pct, label, chkId] = STEPS[si++];
      onProgress(pct, label, chkId);

      if (si === 2) {
        try {
          const buf = Buffer.alloc(65536);
          const fd = fs.openSync(filePath, "r");
          const read = fs.readSync(fd, buf, 0, 65536, 0);
          fs.closeSync(fd);
          const str = buf.slice(0, read).toString("latin1");
          for (const [sig, label] of INDICATORS) {
            if (str.toLowerCase().includes(sig.toLowerCase())) {
              if (!threats.includes(label)) threats.push(label);
            }
          }
        } catch {}
      }
      setTimeout(next, 220 + Math.random() * 180);
    };
    next();
  });
}

// ── ClamAV scan ───────────────────────────────────────────────────────────────
function runClamScan(
  filePath: string,
  onProgress: (pct: number, step: string, checkId: string) => void
): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    onProgress(5, "Starte ClamAV…", "sig");
    const proc = spawn("clamscan", ["--verbose", "--no-summary", filePath]);
    let output = "";
    let pct = 5;
    proc.stdout.on("data", (c: Buffer) => { output += c.toString(); pct = Math.min(90, pct + 7); onProgress(pct, "ClamAV analysiert…", "heur"); });
    proc.stderr.on("data", (c: Buffer) => { output += c.toString(); });
    proc.on("close", code => {
      onProgress(100, "Fertig", "done");
      const lines = output.split("\n").filter(l => l.includes("FOUND"));
      const threats = lines.map(l => { const m = l.match(/: (.+) FOUND/); return m ? m[1] : l.trim(); });
      resolve({ clean: code === 0 && threats.length === 0, threats });
    });
    proc.on("error", () => runHeuristicScan(filePath, onProgress).then(resolve));
  });
}

// ── GitHub Release resolver ───────────────────────────────────────────────────
async function resolveGithubRelease(url: string): Promise<{ downloadUrl: string; fileName: string; size?: number } | null> {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/\s]+)/);
  if (!match) return null;
  const [, owner, repo, tag] = match;
  return new Promise(resolve => {
    const req = https.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
      { headers: { "User-Agent": "Tevive/1.0", "Accept": "application/vnd.github.v3+json" } },
      res => {
        let data = "";
        res.on("data", (c: Buffer) => data += c.toString());
        res.on("end", () => {
          try {
            const r = JSON.parse(data);
            const assets: { browser_download_url: string; name: string; size: number }[] = r.assets || [];
            const asset = assets.find(a => a.name.endsWith(".exe")) || assets.find(a => a.name.endsWith(".zip")) || assets[0];
            resolve(asset ? { downloadUrl: asset.browser_download_url, fileName: asset.name, size: asset.size } : null);
          } catch { resolve(null); }
        });
      });
    req.on("error", () => resolve(null));
  });
}

// ── Real download ─────────────────────────────────────────────────────────────
function startRealDownload(downloadId: string, downloadUrl: string, destPath: string, win: BrowserWindow, totalSize?: number) {
  const proto = downloadUrl.startsWith("https") ? https : http;
  let received = 0, lastTime = Date.now(), lastBytes = 0, speed = 0;
  const file = fs.createWriteStream(destPath);

  const doRequest = (url: string) => {
    const req = proto.get(url, { headers: { "User-Agent": "Tevive/1.0" } }, res => {
      if (res.statusCode && [301,302,307].includes(res.statusCode) && res.headers.location) {
        doRequest(res.headers.location); return;
      }
      const total = totalSize || parseInt(res.headers["content-length"] || "0", 10) || 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length; file.write(chunk);
        const now = Date.now(), elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.5) { speed = (received - lastBytes) / elapsed; lastTime = now; lastBytes = received; }
        const progress = total > 0 ? Math.min(99, (received / total) * 100) : -1;
        const entry = activeDownloads.get(downloadId);
        if (entry) Object.assign(entry, { progress, speed, received, total });
        win.webContents.send("download-progress", { id: downloadId, progress, speed, received, total, done: false });
      });
      res.on("end", () => {
        file.end();
        const entry = activeDownloads.get(downloadId);
        if (entry) { entry.progress = 100; entry.done = true; }
        win.webContents.send("download-progress", { id: downloadId, progress: 100, speed: 0, received, total: received, done: true, destPath });
      });
      res.on("error", (err: Error) => {
        file.end();
        win.webContents.send("download-progress", { id: downloadId, progress: 0, done: true, error: err.message });
      });
    });
    req.on("error", (err: Error) => {
      file.end();
      win.webContents.send("download-progress", { id: downloadId, progress: 0, done: true, error: err.message });
    });
    activeDownloads.set(downloadId, { req, cancel: () => { req.destroy(); file.destroy(); try { fs.unlinkSync(destPath); } catch {} }, progress: 0, speed: 0, received: 0, total: totalSize || 0, done: false });
  };
  doRequest(downloadUrl);
}

const activeDownloads = new Map<string, { req: import("http").ClientRequest; cancel: () => void; progress: number; speed: number; received: number; total: number; done: boolean; error?: string }>();

// ── Windows ───────────────────────────────────────────────────────────────────
function createSplashWindow(): BrowserWindow {
  const s = new BrowserWindow({ width: 500, height: 300, frame: false, transparent: false, resizable: false, center: true, alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#0a0e14", webPreferences: { nodeIntegration: false, contextIsolation: true } });
  s.loadFile(path.join(__dirname, "../build/splash.html"));
  return s;
}

let mainWin: BrowserWindow | null = null;

function createMainWindow(splash: BrowserWindow) {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640, show: false,
    title: "Tevive", backgroundColor: "#0a0e14",
    icon: path.join(__dirname, "../build/icon.ico"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true, webviewTag: false },
  });
  mainWin = win;
  nativeTheme.themeSource = "dark";
  win.loadFile(path.join(__dirname, "../build/index.html"));
  win.webContents.on("did-finish-load", () => { splash.destroy(); win.show(); win.focus(); if (!isDev) autoUpdater.checkForUpdatesAndNotify(); });
  win.webContents.on("did-fail-load", () => { splash.destroy(); win.show(); win.webContents.loadFile(path.join(__dirname, "../build/error.html")); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.on("page-title-updated", e => e.preventDefault());
}

// ── IPC: Settings ─────────────────────────────────────────────────────────────
ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_e, s: Partial<Settings>) => {
  const current = loadSettings();
  const updated = { ...current, ...s };
  saveSettings(updated);
  if (updated.downloadDir) ensureDir(updated.downloadDir);
  return updated;
});

// ── IPC: Users ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ["#1a9fff","#4ade80","#f87171","#fbbf24","#a78bfa","#34d399","#f472b6","#60a5fa"];

ipcMain.handle("auth-register", (_e, { username, email, password }: { username: string; email: string; password: string }) => {
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return { error: "E-Mail bereits registriert" };
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return { error: "Benutzername bereits vergeben" };
  if (username.length < 3) return { error: "Benutzername muss mindestens 3 Zeichen haben" };
  if (password.length < 6) return { error: "Passwort muss mindestens 6 Zeichen haben" };
  const user: User = {
    id: Date.now().toString(),
    username, email,
    passwordHash: hashPw(password),
    createdAt: new Date().toISOString(),
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  };
  users.push(user);
  saveUsers(users);
  return { user: { id: user.id, username: user.username, email: user.email, avatarColor: user.avatarColor, createdAt: user.createdAt } };
});

ipcMain.handle("auth-login", (_e, { email, password }: { email: string; password: string }) => {
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return { error: "E-Mail nicht gefunden" };
  if (user.passwordHash !== hashPw(password)) return { error: "Falsches Passwort" };
  return { user: { id: user.id, username: user.username, email: user.email, avatarColor: user.avatarColor, createdAt: user.createdAt } };
});

ipcMain.handle("auth-update-username", (_e, { userId, username }: { userId: string; username: string }) => {
  const users = loadUsers();
  if (users.find(u => u.id !== userId && u.username.toLowerCase() === username.toLowerCase())) return { error: "Benutzername bereits vergeben" };
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { error: "Benutzer nicht gefunden" };
  users[idx].username = username;
  saveUsers(users);
  return { username };
});

// ── IPC: Games ────────────────────────────────────────────────────────────────
ipcMain.handle("get-games", () => loadGames());
ipcMain.handle("add-game", (_e, game: Omit<Game, "id" | "addedAt" | "scanStatus" | "installed" | "published">) => {
  const games = loadGames();
  const g: Game = { ...game, id: Date.now().toString(), addedAt: new Date().toISOString(), scanStatus: "pending", installed: false, published: false };
  games.push(g);
  saveGames(games);
  return g;
});
ipcMain.handle("update-game", (_e, id: string, patch: Partial<Game>) => {
  const games = loadGames();
  const idx = games.findIndex(g => g.id === id);
  if (idx !== -1) { games[idx] = { ...games[idx], ...patch }; saveGames(games); return games[idx]; }
  return null;
});
ipcMain.handle("delete-game", (_e, id: string) => { saveGames(loadGames().filter(g => g.id !== id)); return true; });

// ── IPC: Scan + upload ────────────────────────────────────────────────────────
ipcMain.handle("scan-and-publish", async (e, { gameId, filePath }: { gameId: string; filePath: string }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const id = `scan_${Date.now()}`;
  const fileName = path.basename(filePath);

  // Mark game as scanning
  const games = loadGames();
  const gIdx = games.findIndex(g => g.id === gameId);
  if (gIdx !== -1) { games[gIdx].scanStatus = "scanning"; games[gIdx].localPath = filePath; saveGames(games); }

  const scans = loadScans();
  const record: ScanRecord = { id, fileName, filePath, startedAt: new Date().toISOString(), status: "scanning", engine: "Heuristik", gameId };
  scans.unshift(record);
  saveScans(scans);

  win?.webContents.send("scan-progress", { gameId, id, pct: 0, step: "Starte Scanner…", checkId: "sig", status: "scanning" });

  const hasClamAv = await clamAvAvailable();
  if (hasClamAv) record.engine = "ClamAV";

  const onProgress = (pct: number, step: string, checkId: string) => {
    win?.webContents.send("scan-progress", { gameId, id, pct, step, checkId, status: "scanning" });
  };

  const result = hasClamAv
    ? await runClamScan(filePath, onProgress)
    : await runHeuristicScan(filePath, onProgress);

  record.status = result.clean ? "clean" : "threat";
  record.threats = result.threats;
  record.finishedAt = new Date().toISOString();

  // Update games
  const g2 = loadGames();
  const gi = g2.findIndex(g => g.id === gameId);
  if (gi !== -1) {
    g2[gi].scanStatus = result.clean ? "clean" : "threat";
    g2[gi].scanEngine = record.engine;
    g2[gi].threats = result.threats;
    if (result.clean) g2[gi].published = true;
    saveGames(g2);
  }

  // Save scan record
  const allScans = loadScans();
  const si = allScans.findIndex(s => s.id === id);
  if (si !== -1) allScans[si] = record; else allScans.unshift(record);
  saveScans(allScans);

  win?.webContents.send("scan-progress", { gameId, id, pct: 100, step: "Fertig", checkId: "done", status: record.status, threats: result.threats, engine: record.engine });

  return record;
});

ipcMain.handle("get-scan-history", () => loadScans().slice(0, 50));
ipcMain.handle("pick-thumbnail", async () => {
  const r = await dialog.showOpenDialog({ title: "Thumbnail auswählen", filters: [{ name: "Bilder", extensions: ["png","jpg","jpeg","webp","gif"] }], properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("pick-game-file", async () => {
  const r = await dialog.showOpenDialog({ title: "Spiel-Datei auswählen", filters: [{ name: "Spiel-Dateien", extensions: ["exe","zip","rar","msi","7z"] }], properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("resolve-github-release", (_e, url: string) => resolveGithubRelease(url));

// ── IPC: Downloads ────────────────────────────────────────────────────────────
ipcMain.handle("start-download", async (e, { gameId, downloadUrl, fileName, totalSize }: { gameId: string; downloadUrl: string; fileName: string; totalSize?: number }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return { error: "No window" };
  const settings = loadSettings();
  // Always ask where to save
  const saveResult = await dialog.showSaveDialog(win, {
    title: "Speicherort wählen",
    defaultPath: path.join(settings.downloadDir, fileName),
    filters: [{ name: "Alle Dateien", extensions: ["*"] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
  ensureDir(path.dirname(saveResult.filePath));
  const downloadId = `dl_${gameId}_${Date.now()}`;
  startRealDownload(downloadId, downloadUrl, saveResult.filePath, win, totalSize);
  const games = loadGames();
  const idx = games.findIndex(g => g.id === gameId);
  if (idx !== -1) { games[idx].localPath = saveResult.filePath; saveGames(games); }
  return { downloadId, destPath: saveResult.filePath };
});

ipcMain.handle("cancel-download", (_e, id: string) => {
  const dl = activeDownloads.get(id);
  if (dl) { dl.cancel(); activeDownloads.delete(id); }
  return true;
});

// ── IPC: System ───────────────────────────────────────────────────────────────
ipcMain.handle("open-in-folder", (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle("launch-game", (_e, p: string) => shell.openPath(p));
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("pick-download-folder", async () => {
  const r = await dialog.showOpenDialog({ title: "Download-Ordner wählen", properties: ["openDirectory","createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.handle("tevive-local", request => {
    const filePath = decodeURIComponent(request.url.replace("tevive-local://", ""));
    return net.fetch("file://" + filePath);
  });
  const settings = loadSettings();
  ensureDir(settings.downloadDir);
  const splash = createSplashWindow();
  setTimeout(() => createMainWindow(splash), 1400);
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const splash = createSplashWindow();
    setTimeout(() => createMainWindow(splash), 1400);
  }
});
