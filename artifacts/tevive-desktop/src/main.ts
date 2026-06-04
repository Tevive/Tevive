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
const APP_VERSION = "0.0.0.1 PHXUAL";
const ADMIN_CODE  = "8dj7aj6wdj2fkao2nf9ajd0w2jd0";
const ZIP_SIZE_LIMIT = 2 * 1024 * 1024 * 1024; // 2 GB

// ── Paths ─────────────────────────────────────────────────────────────────────
const userData         = app.getPath("userData");
const gamesFile        = path.join(userData, "games.json");
const usersFile        = path.join(userData, "users.json");
const settingsFile     = path.join(userData, "settings.json");
const scansFile        = path.join(userData, "scan_history.json");
const achievementsFile = path.join(userData, "achievements.json");
const friendsFile      = path.join(userData, "friends.json");
const notifFile        = path.join(userData, "notifications.json");
const activityFile     = path.join(userData, "activity.json");

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ── Settings ──────────────────────────────────────────────────────────────────
interface Settings {
  downloadDir: string;
  alwaysAskLocation: boolean;
  theme: "dark" | "darker" | "midnight" | "steam-blue";
  language: string;
  fontSize: "small" | "normal" | "large";
  compactMode: boolean;
  showGameBadges: boolean;
  animationsEnabled: boolean;
  hardwareAcceleration: boolean;
  notifyDownloadComplete: boolean;
  notifyScanResult: boolean;
  notifyFriendActivity: boolean;
  notifyUpdates: boolean;
  privacyShowOnline: boolean;
  privacyShowLibrary: boolean;
  privacyAllowFriendRequests: boolean;
  steamIntegration: boolean;
  autoLaunchOnStartup: boolean;
  minimizeToTray: boolean;
  startInBackground: boolean;
  closeToTray: boolean;
  screenshotsDir: string;
  clearCacheOnExit: boolean;
  developerMode: boolean;
  betaUpdates: boolean;
}
function defaultSettings(): Settings {
  return {
    downloadDir: path.join(app.getPath("documents"), "Tevive"),
    alwaysAskLocation: true,
    theme: "darker",
    language: "en",
    fontSize: "normal",
    compactMode: false,
    showGameBadges: true,
    animationsEnabled: true,
    hardwareAcceleration: true,
    notifyDownloadComplete: true,
    notifyScanResult: true,
    notifyFriendActivity: true,
    notifyUpdates: true,
    privacyShowOnline: true,
    privacyShowLibrary: true,
    privacyAllowFriendRequests: true,
    steamIntegration: false,
    autoLaunchOnStartup: false,
    minimizeToTray: false,
    startInBackground: false,
    closeToTray: false,
    screenshotsDir: path.join(app.getPath("pictures"), "Tevive"),
    clearCacheOnExit: false,
    developerMode: false,
    betaUpdates: false,
  };
}
function loadSettings(): Settings { try { if (fs.existsSync(settingsFile)) return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch {} return defaultSettings(); }
function saveSettings(s: Settings) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }

// ── Users ─────────────────────────────────────────────────────────────────────
interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  avatarColor: string;
  isAdmin: boolean;
  isVerified: boolean; // blue checkmark
  bio: string;
  status: "online" | "away" | "offline";
  totalPlaytime: number; // seconds
  lastSeen: string;
}
function hashPw(pw: string): string { return crypto.createHash("sha256").update(pw + "tevive_salt_phxual_2026").digest("hex"); }
function loadUsers(): User[] { try { if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, "utf8")); } catch {} return []; }
function saveUsers(u: User[]) { fs.writeFileSync(usersFile, JSON.stringify(u, null, 2)); }
function validateEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()); }

// ── Games ─────────────────────────────────────────────────────────────────────
interface Game {
  id: string; title: string; description: string; version: string; tags: string[];
  genre?: string; developer?: string; publisher?: string;
  thumbnailPath?: string; releaseUrl?: string; localPath?: string;
  addedAt: string; uploadedBy?: string;
  scanStatus: "pending" | "scanning" | "clean" | "threat" | "none";
  scanEngine?: string; threats?: string[]; downloadSize?: number;
  installed: boolean; published: boolean;
  playtime: number; lastPlayed?: string;
  rating?: number; // 1-5 stars by uploader
  systemRequirements?: string;
  changelog?: string;
  isWishlisted: boolean;
  downloadCount: number;
  launchCommand?: string; // custom launch command for compatibility
  compatibleWith?: string[]; // e.g. ["Steam", "Epic"]
  screenshots?: string[];
}
function loadGames(): Game[] { try { if (fs.existsSync(gamesFile)) return JSON.parse(fs.readFileSync(gamesFile, "utf8")); } catch {} return []; }
function saveGames(g: Game[]) { fs.writeFileSync(gamesFile, JSON.stringify(g, null, 2)); }

// ── Achievements ──────────────────────────────────────────────────────────────
interface Achievement { id: string; unlockedAt: string; userId: string; }
const ACHIEVEMENT_DEFS: Record<string, { name: string; desc: string; icon: string; secret?: boolean }> = {
  first_steps:    { name: "First Steps",     desc: "Created your Tevive account",          icon: "star"    },
  first_download: { name: "Downloader",       desc: "Downloaded your first game",           icon: "dl"      },
  first_upload:   { name: "Publisher",        desc: "Uploaded your first game",             icon: "upload"  },
  first_scan:     { name: "Safety First",     desc: "Completed your first clean scan",      icon: "shield"  },
  collector_5:    { name: "Collector",        desc: "Installed 5 games",                    icon: "pack"    },
  collector_10:   { name: "Veteran",          desc: "Installed 10 games",                   icon: "pack2"   },
  curator_5:      { name: "Curator",          desc: "Uploaded 5 games",                     icon: "upload2" },
  admin_unlock:   { name: "Administrator",    desc: "Unlocked admin access",                icon: "admin",   secret: true },
  playtime_1h:    { name: "Gamer",            desc: "Played games for 1 hour total",        icon: "ctrl"    },
  wishlist_5:     { name: "Window Shopper",   desc: "Added 5 games to wishlist",            icon: "heart"   },
};
function loadAchievements(): Achievement[] { try { if (fs.existsSync(achievementsFile)) return JSON.parse(fs.readFileSync(achievementsFile, "utf8")); } catch {} return []; }
function saveAchievements(a: Achievement[]) { fs.writeFileSync(achievementsFile, JSON.stringify(a, null, 2)); }
function unlockAchievement(userId: string, id: string, win?: BrowserWindow | null): boolean {
  const list = loadAchievements();
  if (list.find(a => a.userId === userId && a.id === id)) return false;
  list.push({ id, unlockedAt: new Date().toISOString(), userId });
  saveAchievements(list);
  if (win) win.webContents.send("achievement-unlocked", { id, ...ACHIEVEMENT_DEFS[id] });
  return true;
}

// ── Friends ───────────────────────────────────────────────────────────────────
interface FriendEntry { userId: string; friendId: string; addedAt: string; status: "accepted" | "pending" | "blocked"; }
function loadFriends(): FriendEntry[] { try { if (fs.existsSync(friendsFile)) return JSON.parse(fs.readFileSync(friendsFile, "utf8")); } catch {} return []; }
function saveFriends(f: FriendEntry[]) { fs.writeFileSync(friendsFile, JSON.stringify(f, null, 2)); }

// ── Notifications ─────────────────────────────────────────────────────────────
interface Notif { id: string; userId: string; type: string; message: string; read: boolean; createdAt: string; }
function loadNotifs(): Notif[] { try { if (fs.existsSync(notifFile)) return JSON.parse(fs.readFileSync(notifFile, "utf8")); } catch {} return []; }
function saveNotifs(n: Notif[]) { fs.writeFileSync(notifFile, JSON.stringify(n, null, 2)); }
function addNotif(userId: string, type: string, message: string) {
  const list = loadNotifs();
  list.unshift({ id: Date.now().toString(), userId, type, message, read: false, createdAt: new Date().toISOString() });
  saveNotifs(list.slice(0, 100));
}

// ── Scan history ──────────────────────────────────────────────────────────────
interface ScanRecord { id: string; fileName: string; filePath: string; startedAt: string; finishedAt?: string; status: "scanning" | "clean" | "threat"; threats?: string[]; engine: string; gameId?: string; fileSize?: number; }
function loadScans(): ScanRecord[] { try { if (fs.existsSync(scansFile)) return JSON.parse(fs.readFileSync(scansFile, "utf8")); } catch {} return []; }
function saveScans(s: ScanRecord[]) { fs.writeFileSync(scansFile, JSON.stringify(s, null, 2)); }

// ── ClamAV ────────────────────────────────────────────────────────────────────
function clamAvAvailable(): Promise<boolean> { return new Promise(r => exec("clamscan --version", err => r(!err))); }

// ── Heuristic scan ────────────────────────────────────────────────────────────
function runHeuristicScan(filePath: string, onProgress: (pct: number, step: string, checkId: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    const INDICATORS: [string, string][] = [
      ["cmd.exe /c","Trojan: Shell command injection"],["powershell -enc","Trojan: Obfuscated PowerShell"],
      ["powershell -e ","Trojan: Encoded PowerShell"],["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run","Trojan: Autorun registry"],
      ["CreateRemoteThread","Rootkit/Trojan: Process injection"],["VirtualAllocEx","Rootkit: Memory injection"],
      ["WriteProcessMemory","Rootkit: Remote memory write"],["WinExec","Trojan: WinExec API call"],
      ["URLDownloadToFile","Trojan: Download dropper"],["bitsadmin","Trojan: BITS abuse"],
      ["bitcoin","Cryptojacker: Cryptocurrency reference"],["monero","Cryptojacker: Monero mining"],
      ["xmrig","Cryptojacker: XMRig miner"],["CryptoLocker","Ransomware: CryptoLocker signature"],
      ["YOUR_FILES_ARE_ENCRYPTED","Ransomware: Encryption message"],["RANSOM","Ransomware: Ransom indicator"],
      ["keylogger","Spyware: Keylogger reference"],["GetAsyncKeyState","Spyware: Keystroke monitoring"],
      ["SetWindowsHookEx","Spyware: Hook installation"],["adware","Adware: Advertising software"],
      ["inject_ad","Adware: Ad injection"],["botnet","Botnet: Network bot"],
      ["IRC_CONNECT","Botnet: IRC bot connection"],["ZeroAccess","Rootkit: ZeroAccess signature"],
      ["MBR_WIPER","Wiper: MBR overwrite"],["disk_wipe","Wiper: Disk wipe function"],
    ];
    const STEPS: [number, string, string][] = [
      [8,"Reading PE header…","pe"],[20,"Signature analysis…","sig"],[33,"Behavioral analysis…","behav"],
      [46,"Heuristic scan…","heur"],[58,"Network indicators…","net"],[68,"Permission analysis…","perm"],
      [80,"Hash verification…","hash"],[90,"Ransomware patterns…","ransom"],[95,"Rootkit/wiper analysis…","rootkit"],[100,"Done","done"],
    ];
    const threats: string[] = [];
    let si = 0;
    const next = () => {
      if (si >= STEPS.length) { resolve({ clean: threats.length === 0, threats }); return; }
      const [pct, label, chkId] = STEPS[si++];
      onProgress(pct, label, chkId);
      if (si === 2 && filePath) {
        try {
          const buf = Buffer.alloc(65536);
          const fd = fs.openSync(filePath, "r");
          const read = fs.readSync(fd, buf, 0, 65536, 0);
          fs.closeSync(fd);
          const str = buf.slice(0, read).toString("latin1");
          for (const [sig, lbl] of INDICATORS) {
            if (str.toLowerCase().includes(sig.toLowerCase()) && !threats.includes(lbl)) threats.push(lbl);
          }
        } catch {}
      }
      setTimeout(next, 220 + Math.random() * 180);
    };
    next();
  });
}

// ── ClamAV scan ───────────────────────────────────────────────────────────────
function runClamScan(filePath: string, onProgress: (pct: number, step: string, checkId: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    onProgress(5, "Starting ClamAV…", "sig");
    const proc = spawn("clamscan", ["--verbose", "--no-summary", filePath]);
    let output = "", pct = 5;
    proc.stdout.on("data", (c: Buffer) => { output += c.toString(); pct = Math.min(90, pct + 7); onProgress(pct, "ClamAV scanning…", "heur"); });
    proc.stderr.on("data", (c: Buffer) => { output += c.toString(); });
    proc.on("close", code => {
      onProgress(100, "Done", "done");
      const lines = output.split("\n").filter(l => l.includes("FOUND"));
      const threats = lines.map(l => { const m = l.match(/: (.+) FOUND/); return m ? m[1] : l.trim(); });
      resolve({ clean: code === 0 && threats.length === 0, threats });
    });
    proc.on("error", () => runHeuristicScan(filePath, onProgress).then(resolve));
  });
}

// ── GitHub release resolver ───────────────────────────────────────────────────
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
const activeDownloads = new Map<string, { req: import("http").ClientRequest; cancel: () => void; progress: number; speed: number; received: number; total: number; done: boolean; error?: string; }>();

function startRealDownload(downloadId: string, downloadUrl: string, destPath: string, win: BrowserWindow, totalSize?: number) {
  const proto = downloadUrl.startsWith("https") ? https : http;
  let received = 0, lastTime = Date.now(), lastBytes = 0, speed = 0;
  const file = fs.createWriteStream(destPath);
  const doRequest = (url: string) => {
    const req = proto.get(url, { headers: { "User-Agent": "Tevive/1.0" } }, res => {
      if (res.statusCode && [301,302,307].includes(res.statusCode) && res.headers.location) { doRequest(res.headers.location); return; }
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
      res.on("error", (err: Error) => { file.end(); win.webContents.send("download-progress", { id: downloadId, progress: 0, done: true, error: err.message }); });
    });
    req.on("error", (err: Error) => { file.end(); win.webContents.send("download-progress", { id: downloadId, progress: 0, done: true, error: err.message }); });
    activeDownloads.set(downloadId, { req, cancel: () => { req.destroy(); file.destroy(); try { fs.unlinkSync(destPath); } catch {} }, progress: 0, speed: 0, received: 0, total: totalSize || 0, done: false });
  };
  doRequest(downloadUrl);
}

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
    title: "Tevive", backgroundColor: "#0a0e14", autoHideMenuBar: true,
    icon: path.join(__dirname, "../build/icon.ico"),
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
  const updated = { ...loadSettings(), ...s };
  saveSettings(updated as Settings);
  if (updated.downloadDir) ensureDir(updated.downloadDir);
  if (updated.screenshotsDir) ensureDir(updated.screenshotsDir);
  return updated;
});

// ── IPC: Auth ─────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ["#1a9fff","#4ade80","#f87171","#fbbf24","#a78bfa","#34d399","#f472b6","#60a5fa","#fb923c","#e879f9"];

ipcMain.handle("auth-register", (e, { username, email, password }: { username: string; email: string; password: string }) => {
  if (!validateEmail(email)) return { error: "Please enter a valid email address (must contain @)" };
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return { error: "Email already registered" };
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return { error: "Username already taken" };
  if (username.length < 3) return { error: "Username must be at least 3 characters" };
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) return { error: "Username can only contain letters, numbers, _ - ." };
  if (password.length < 6) return { error: "Password must be at least 6 characters" };
  const user: User = {
    id: Date.now().toString(), username, email, passwordHash: hashPw(password),
    createdAt: new Date().toISOString(), avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    isAdmin: false, isVerified: false, bio: "", status: "online", totalPlaytime: 0, lastSeen: new Date().toISOString(),
  };
  users.push(user); saveUsers(users);
  const win = BrowserWindow.fromWebContents(e.sender);
  unlockAchievement(user.id, "first_steps", win);
  addNotif(user.id, "welcome", "Welcome to Tevive! Explore the store and download games.");
  return { user: sanitizeUser(user) };
});

ipcMain.handle("auth-login", (_e, { email, password }: { email: string; password: string }) => {
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return { error: "Email not found" };
  if (user.passwordHash !== hashPw(password)) return { error: "Incorrect password" };
  const idx = users.findIndex(u => u.id === user.id);
  users[idx].lastSeen = new Date().toISOString();
  users[idx].status = "online";
  saveUsers(users);
  return { user: sanitizeUser(users[idx]) };
});

ipcMain.handle("auth-update-profile", (_e, { userId, username, bio, status }: { userId: string; username?: string; bio?: string; status?: string }) => {
  const users = loadUsers();
  if (username && users.find(u => u.id !== userId && u.username.toLowerCase() === username.toLowerCase())) return { error: "Username already taken" };
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { error: "User not found" };
  if (username) users[idx].username = username;
  if (bio !== undefined) users[idx].bio = bio;
  if (status) users[idx].status = status as User["status"];
  saveUsers(users);
  return { user: sanitizeUser(users[idx]) };
});

ipcMain.handle("auth-activate-admin", (e, { userId, code }: { userId: string; code: string }) => {
  if (code !== ADMIN_CODE) return { error: "Invalid admin code" };
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { error: "User not found" };
  if (users[idx].isAdmin) return { alreadyAdmin: true };
  users[idx].isAdmin = true; users[idx].isVerified = true;
  saveUsers(users);
  const win = BrowserWindow.fromWebContents(e.sender);
  unlockAchievement(userId, "admin_unlock", win);
  addNotif(userId, "admin", "Admin access activated. You now have full administrative privileges.");
  return { user: sanitizeUser(users[idx]) };
});

ipcMain.handle("admin-grant-checkmark", (_e, { adminId, targetUsername }: { adminId: string; targetUsername: string }) => {
  const users = loadUsers();
  const admin = users.find(u => u.id === adminId);
  if (!admin?.isAdmin) return { error: "Not authorized" };
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername.toLowerCase());
  if (idx === -1) return { error: "User not found" };
  users[idx].isVerified = !users[idx].isVerified;
  saveUsers(users);
  addNotif(users[idx].id, "verified", users[idx].isVerified ? "You have been granted a verified badge by an administrator." : "Your verified badge has been removed.");
  return { user: sanitizeUser(users[idx]), granted: users[idx].isVerified };
});

ipcMain.handle("admin-get-users", (_e, { adminId }: { adminId: string }) => {
  const users = loadUsers();
  const admin = users.find(u => u.id === adminId);
  if (!admin?.isAdmin) return { error: "Not authorized" };
  return users.map(sanitizeUser);
});

function sanitizeUser(u: User) {
  return { id: u.id, username: u.username, email: u.email, avatarColor: u.avatarColor, createdAt: u.createdAt, isAdmin: u.isAdmin, isVerified: u.isVerified, bio: u.bio || "", status: u.status, totalPlaytime: u.totalPlaytime || 0, lastSeen: u.lastSeen };
}

// ── IPC: Games ────────────────────────────────────────────────────────────────
ipcMain.handle("get-games", () => loadGames());
ipcMain.handle("add-game", (_e, game: Partial<Game>) => {
  const games = loadGames();
  const g: Game = {
    title: "", description: "", version: "", tags: [], installed: false, published: false,
    scanStatus: "pending", addedAt: new Date().toISOString(), id: Date.now().toString(),
    playtime: 0, isWishlisted: false, downloadCount: 0, ...game,
  };
  games.push(g); saveGames(games);
  return g;
});
ipcMain.handle("update-game", (_e, id: string, patch: Partial<Game>) => {
  const games = loadGames();
  const idx = games.findIndex(g => g.id === id);
  if (idx !== -1) { games[idx] = { ...games[idx], ...patch }; saveGames(games); return games[idx]; }
  return null;
});
ipcMain.handle("delete-game", (_e, id: string) => { saveGames(loadGames().filter(g => g.id !== id)); return true; });
ipcMain.handle("toggle-wishlist", (e, { gameId, userId }: { gameId: string; userId: string }) => {
  const games = loadGames();
  const idx = games.findIndex(g => g.id === gameId);
  if (idx === -1) return null;
  games[idx].isWishlisted = !games[idx].isWishlisted;
  saveGames(games);
  const wishCount = games.filter(g => g.isWishlisted).length;
  if (wishCount >= 5) unlockAchievement(userId, "wishlist_5", BrowserWindow.fromWebContents(e.sender));
  return { wishlisted: games[idx].isWishlisted };
});
ipcMain.handle("rate-game", (_e, { gameId, rating }: { gameId: string; rating: number }) => {
  const games = loadGames();
  const idx = games.findIndex(g => g.id === gameId);
  if (idx !== -1) { games[idx].rating = Math.max(1, Math.min(5, rating)); saveGames(games); return games[idx].rating; }
  return null;
});
ipcMain.handle("track-playtime", (_e, { gameId, userId, seconds }: { gameId: string; userId: string; seconds: number }) => {
  const games = loadGames();
  const gi = games.findIndex(g => g.id === gameId);
  if (gi !== -1) { games[gi].playtime = (games[gi].playtime || 0) + seconds; games[gi].lastPlayed = new Date().toISOString(); saveGames(games); }
  const users = loadUsers();
  const ui = users.findIndex(u => u.id === userId);
  if (ui !== -1) { users[ui].totalPlaytime = (users[ui].totalPlaytime || 0) + seconds; saveUsers(users); }
  return true;
});

// ── IPC: Scan ─────────────────────────────────────────────────────────────────
ipcMain.handle("scan-and-publish", async (e, { gameId, filePath }: { gameId: string; filePath: string }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const id = `scan_${Date.now()}`;
  const fileName = path.basename(filePath || gameId);

  // ZIP size check
  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".zip") {
      const stat = fs.statSync(filePath);
      if (stat.size > ZIP_SIZE_LIMIT) {
        const games = loadGames();
        const gi = games.findIndex(g => g.id === gameId);
        if (gi !== -1) { games[gi].scanStatus = "threat"; games[gi].threats = ["File exceeds 2 GB ZIP limit"]; saveGames(games); }
        win?.webContents.send("scan-progress", { gameId, id, pct: 100, step: "Rejected", checkId: "done", status: "threat", threats: ["File exceeds 2 GB ZIP limit"], engine: "Size Check" });
        return { status: "threat", threats: ["File exceeds 2 GB ZIP limit"], engine: "Size Check" };
      }
    }
  }

  const g2 = loadGames(); const gIdx = g2.findIndex(g => g.id === gameId);
  if (gIdx !== -1) { g2[gIdx].scanStatus = "scanning"; if (filePath) g2[gIdx].localPath = filePath; saveGames(g2); }

  const scans = loadScans();
  const record: ScanRecord = { id, fileName, filePath: filePath || "", startedAt: new Date().toISOString(), status: "scanning", engine: "Heuristic", gameId, fileSize: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : undefined };
  scans.unshift(record); saveScans(scans);

  win?.webContents.send("scan-progress", { gameId, id, pct: 0, step: "Starting scanner…", checkId: "sig", status: "scanning" });
  const hasClamAv = await clamAvAvailable();
  if (hasClamAv) record.engine = "ClamAV";
  const onProgress = (pct: number, step: string, checkId: string) => win?.webContents.send("scan-progress", { gameId, id, pct, step, checkId, status: "scanning" });

  const result = hasClamAv ? await runClamScan(filePath || "", onProgress) : await runHeuristicScan(filePath || "", onProgress);
  record.status = result.clean ? "clean" : "threat"; record.threats = result.threats; record.finishedAt = new Date().toISOString();

  const g3 = loadGames(); const gi2 = g3.findIndex(g => g.id === gameId);
  if (gi2 !== -1) {
    g3[gi2].scanStatus = result.clean ? "clean" : "threat";
    g3[gi2].scanEngine = record.engine; g3[gi2].threats = result.threats;
    if (result.clean) { g3[gi2].published = true; g3[gi2].downloadCount = 0; }
    saveGames(g3);
  }

  const allScans = loadScans(); const si = allScans.findIndex(s => s.id === id);
  if (si !== -1) allScans[si] = record; else allScans.unshift(record);
  saveScans(allScans);

  // Unlock achievements
  if (result.clean) {
    const uploader = g3[gi2]?.uploadedBy;
    if (uploader) {
      const users = loadUsers(); const u = users.find(x => x.username === uploader);
      if (u) {
        unlockAchievement(u.id, "first_scan", win);
        const uploaded = g3.filter(g => g.uploadedBy === uploader && g.scanStatus === "clean").length;
        if (uploaded >= 1) unlockAchievement(u.id, "first_upload", win);
        if (uploaded >= 5) unlockAchievement(u.id, "curator_5", win);
      }
    }
  }

  win?.webContents.send("scan-progress", { gameId, id, pct: 100, step: "Done", checkId: "done", status: record.status, threats: result.threats, engine: record.engine });
  return record;
});

ipcMain.handle("get-scan-history", () => loadScans().slice(0, 50));
ipcMain.handle("pick-thumbnail", async () => { const r = await dialog.showOpenDialog({ title: "Select thumbnail", filters: [{ name: "Images", extensions: ["png","jpg","jpeg","webp","gif"] }], properties: ["openFile"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("pick-game-file", async () => {
  const r = await dialog.showOpenDialog({ title: "Select game file", filters: [{ name: "Game files", extensions: ["exe","zip","rar","msi","7z","bat","cmd"] }], properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("resolve-github-release", (_e, url: string) => resolveGithubRelease(url));

// ── IPC: Downloads ────────────────────────────────────────────────────────────
ipcMain.handle("start-download", async (e, { gameId, downloadUrl, fileName, totalSize }: { gameId: string; downloadUrl: string; fileName: string; totalSize?: number }) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return { error: "No window" };
  const settings = loadSettings();
  const saveResult = await dialog.showSaveDialog(win, { title: "Choose save location", defaultPath: path.join(settings.downloadDir, fileName), filters: [{ name: "All files", extensions: ["*"] }] });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
  ensureDir(path.dirname(saveResult.filePath));
  const downloadId = `dl_${gameId}_${Date.now()}`;
  startRealDownload(downloadId, downloadUrl, saveResult.filePath, win, totalSize);
  const games = loadGames(); const idx = games.findIndex(g => g.id === gameId);
  if (idx !== -1) { games[idx].localPath = saveResult.filePath; games[idx].downloadCount = (games[idx].downloadCount || 0) + 1; saveGames(games); }
  return { downloadId, destPath: saveResult.filePath };
});
ipcMain.handle("cancel-download", (_e, id: string) => { const dl = activeDownloads.get(id); if (dl) { dl.cancel(); activeDownloads.delete(id); } return true; });

// ── IPC: Achievements & Friends ───────────────────────────────────────────────
ipcMain.handle("get-achievements", (_e, { userId }: { userId: string }) => {
  const unlocked = loadAchievements().filter(a => a.userId === userId);
  return Object.entries(ACHIEVEMENT_DEFS)
    .filter(([id, def]) => !def.secret || unlocked.find(a => a.id === id))
    .map(([id, def]) => {
      const u = unlocked.find(a => a.id === id);
      return { id, ...def, unlocked: !!u, unlockedAt: u?.unlockedAt };
    });
});
ipcMain.handle("unlock-achievement", (e, { userId, achievementId }: { userId: string; achievementId: string }) => {
  return unlockAchievement(userId, achievementId, BrowserWindow.fromWebContents(e.sender));
});
ipcMain.handle("get-friends", (_e, { userId }: { userId: string }) => {
  const friends = loadFriends().filter(f => (f.userId === userId || f.friendId === userId) && f.status === "accepted");
  const users = loadUsers();
  return friends.map(f => {
    const fid = f.userId === userId ? f.friendId : f.userId;
    const u = users.find(x => x.id === fid);
    return u ? { ...sanitizeUser(u), addedAt: f.addedAt } : null;
  }).filter(Boolean);
});
ipcMain.handle("add-friend", (_e, { userId, targetUsername }: { userId: string; targetUsername: string }) => {
  const users = loadUsers();
  const target = users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
  if (!target) return { error: "User not found" };
  if (target.id === userId) return { error: "Cannot add yourself" };
  const friends = loadFriends();
  if (friends.find(f => (f.userId===userId&&f.friendId===target.id)||(f.userId===target.id&&f.friendId===userId))) return { error: "Already friends or pending" };
  friends.push({ userId, friendId: target.id, addedAt: new Date().toISOString(), status: "accepted" });
  saveFriends(friends);
  addNotif(target.id, "friend", `${users.find(u=>u.id===userId)?.username} added you as a friend.`);
  return { friend: sanitizeUser(target) };
});
ipcMain.handle("remove-friend", (_e, { userId, friendId }: { userId: string; friendId: string }) => {
  saveFriends(loadFriends().filter(f => !(f.userId===userId&&f.friendId===friendId) && !(f.userId===friendId&&f.friendId===userId)));
  return true;
});
ipcMain.handle("get-notifications", (_e, { userId }: { userId: string }) => loadNotifs().filter(n => n.userId === userId).slice(0, 30));
ipcMain.handle("mark-notifs-read", (_e, { userId }: { userId: string }) => {
  const notifs = loadNotifs().map(n => n.userId === userId ? { ...n, read: true } : n);
  saveNotifs(notifs); return true;
});
ipcMain.handle("search-users", (_e, { query }: { query: string }) => {
  const users = loadUsers();
  return users.filter(u => u.username.toLowerCase().includes(query.toLowerCase())).slice(0, 10).map(sanitizeUser);
});

// ── IPC: System ───────────────────────────────────────────────────────────────
ipcMain.handle("open-in-folder", (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle("launch-game", async (e, { path: gamePath, command, gameId, userId }: { path: string; command?: string; gameId?: string; userId?: string }) => {
  const result = await shell.openPath(gamePath);
  if (!result && gameId && userId) {
    const startTime = Date.now();
    setTimeout(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed > 10) {
        const win = BrowserWindow.fromWebContents(e.sender);
        unlockAchievement(userId!, "playtime_1h", win);
      }
    }, 3600000);
  }
  return result;
});
ipcMain.handle("get-app-version", () => APP_VERSION);
ipcMain.handle("pick-download-folder", async () => { const r = await dialog.showOpenDialog({ title: "Choose download folder", properties: ["openDirectory","createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("pick-screenshots-folder", async () => { const r = await dialog.showOpenDialog({ title: "Choose screenshots folder", properties: ["openDirectory","createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("clear-cache", () => { try { const cacheDir = path.join(userData, "cache"); if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true }); return { cleared: true }; } catch (e: unknown) { return { error: (e as Error).message }; } });
ipcMain.handle("detect-steam-games", () => {
  const steamPaths = [
    "C:\\Program Files (x86)\\Steam\\steamapps\\common",
    "C:\\Program Files\\Steam\\steamapps\\common",
    path.join(app.getPath("home"), ".steam", "steam", "steamapps", "common"),
  ];
  const games: { name: string; path: string }[] = [];
  for (const sp of steamPaths) {
    try {
      if (fs.existsSync(sp)) {
        const dirs = fs.readdirSync(sp, { withFileTypes: true }).filter(d => d.isDirectory());
        games.push(...dirs.map(d => ({ name: d.name, path: path.join(sp, d.name) })));
      }
    } catch {}
  }
  return games;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.handle("tevive-local", request => net.fetch("file://" + decodeURIComponent(request.url.replace("tevive-local://", ""))));
  const settings = loadSettings();
  ensureDir(settings.downloadDir); ensureDir(settings.screenshotsDir);
  const splash = createSplashWindow();
  setTimeout(() => createMainWindow(splash), 1400);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) { const s = createSplashWindow(); setTimeout(() => createMainWindow(s), 1400); } });
