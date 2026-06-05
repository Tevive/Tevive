import { app, BrowserWindow, shell, ipcMain, nativeTheme, dialog, protocol, net, nativeImage } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import crypto from "crypto";
import { exec, spawn } from "child_process";

protocol.registerSchemesAsPrivileged([
  { scheme: "tevive-local", privileges: { secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

const isDev = process.env.NODE_ENV === "development";
const APP_VERSION = "0.0.0.1 PHXUAL";
const ADMIN_CODE = "8dj7aj6wdj2fkao2nf9ajd0w2jd0";
const ZIP_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;

// ── Paths ─────────────────────────────────────────────────────────────────────
const userData         = app.getPath("userData");
const gamesFile        = path.join(userData, "games.json");
const usersFile        = path.join(userData, "users.json");
const settingsFile     = path.join(userData, "settings.json");
const scansFile        = path.join(userData, "scan_history.json");
const achievementsFile = path.join(userData, "achievements.json");
const friendsFile      = path.join(userData, "friends.json");
const notifFile        = path.join(userData, "notifications.json");
const collectionsFile  = path.join(userData, "collections.json");
const reviewsFile      = path.join(userData, "reviews.json");
const modsFile         = path.join(userData, "mods.json");
const newsFile         = path.join(userData, "news.json");

function ensureDir(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

// ── Security ──────────────────────────────────────────────────────────────────
function generateSalt(): string { return crypto.randomBytes(32).toString("hex"); }
function hashPw(pw: string, salt?: string): string {
  if (!salt) return crypto.createHash("sha256").update(pw + "tevive_salt_phxual_2026").digest("hex");
  return crypto.pbkdf2Sync(pw, salt, 100000, 64, "sha512").toString("hex");
}
function validateEmail(email: string): { valid: boolean; message: string } {
  const t = email.trim();
  if (!t.includes("@")) return { valid: false, message: "Email must contain @" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return { valid: false, message: "Invalid email format" };
  const domain = t.split("@")[1].toLowerCase();
  const disposable = ["tempmail","throwaway","guerrillamail","mailinator","trashmail","10minutemail","yopmail","fakeinbox","sharklasers","guerrillamailblock","grr.la","spam4.me","dispostable"];
  if (disposable.some(d => domain.includes(d))) return { valid: false, message: "Disposable email addresses not allowed" };
  return { valid: true, message: "Email looks valid" };
}

const loginAttempts = new Map<string, { count: number; until: number }>();
function checkRateLimit(key: string): { blocked: boolean; remaining: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && now < entry.until) return { blocked: true, remaining: Math.ceil((entry.until - now) / 60000) };
  return { blocked: false, remaining: 5 };
}
function recordAttempt(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, until: 0 };
  if (now > entry.until) entry.count = 0;
  entry.count++;
  if (entry.count >= 5) { entry.until = now + 15 * 60 * 1000; entry.count = 0; }
  loginAttempts.set(key, entry);
}
function clearAttempts(key: string) { loginAttempts.delete(key); }

// ── Settings ──────────────────────────────────────────────────────────────────
interface Settings {
  downloadDir: string; alwaysAskLocation: boolean; theme: string; language: string;
  fontSize: string; compactMode: boolean; showGameBadges: boolean; animationsEnabled: boolean;
  notifyDownloadComplete: boolean; notifyScanResult: boolean; notifyFriendActivity: boolean; notifyUpdates: boolean;
  privacyShowOnline: boolean; privacyShowLibrary: boolean; privacyAllowFriendRequests: boolean;
  steamIntegration: boolean; autoLaunchOnStartup: boolean; minimizeToTray: boolean;
  closeToTray: boolean; screenshotsDir: string; clearCacheOnExit: boolean;
  developerMode: boolean; betaUpdates: boolean;
}
function defaultSettings(): Settings {
  return {
    downloadDir: path.join(app.getPath("documents"), "Tevive"), alwaysAskLocation: true,
    theme: "darker", language: "en", fontSize: "normal", compactMode: false,
    showGameBadges: true, animationsEnabled: true,
    notifyDownloadComplete: true, notifyScanResult: true, notifyFriendActivity: true, notifyUpdates: true,
    privacyShowOnline: true, privacyShowLibrary: true, privacyAllowFriendRequests: true,
    steamIntegration: false, autoLaunchOnStartup: false, minimizeToTray: false,
    closeToTray: false, screenshotsDir: path.join(app.getPath("pictures"), "Tevive"),
    clearCacheOnExit: false, developerMode: false, betaUpdates: false,
  };
}
function loadSettings(): Settings { try { if (fs.existsSync(settingsFile)) return { ...defaultSettings(), ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) }; } catch {} return defaultSettings(); }
function saveSettings(s: Settings) { fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)); }

// ── Users ─────────────────────────────────────────────────────────────────────
interface User {
  id: string; username: string; email: string; passwordHash: string; salt?: string;
  createdAt: string; avatarColor: string; isAdmin: boolean; isVerified: boolean;
  bio: string; status: "online" | "away" | "offline"; totalPlaytime: number; lastSeen: string;
}
const AVATAR_COLORS = ["#1a9fff","#4ade80","#f87171","#fbbf24","#a78bfa","#34d399","#f472b6","#60a5fa","#fb923c","#e879f9"];
function loadUsers(): User[] { try { if (fs.existsSync(usersFile)) return JSON.parse(fs.readFileSync(usersFile, "utf8")); } catch {} return []; }
function saveUsers(u: User[]) { fs.writeFileSync(usersFile, JSON.stringify(u, null, 2)); }
function sanitizeUser(u: User) {
  return { id: u.id, username: u.username, avatarColor: u.avatarColor, createdAt: u.createdAt, isAdmin: u.isAdmin, isVerified: u.isVerified, bio: u.bio || "", status: u.status, totalPlaytime: u.totalPlaytime || 0, lastSeen: u.lastSeen };
}
function sanitizeUserWithEmail(u: User) {
  return { ...sanitizeUser(u), email: u.email };
}

// ── Games ─────────────────────────────────────────────────────────────────────
interface Game {
  id: string; title: string; description: string; version: string; tags: string[];
  genre?: string; developer?: string; publisher?: string; thumbnailPath?: string;
  releaseUrl?: string; localPath?: string; addedAt: string; uploadedBy?: string;
  scanStatus: "pending"|"scanning"|"clean"|"threat"|"none"; scanEngine?: string; threats?: string[];
  downloadSize?: number; installed: boolean; published: boolean; playtime: number;
  lastPlayed?: string; rating?: number; systemRequirements?: string; changelog?: string;
  isWishlisted: boolean; downloadCount: number; launchCommand?: string;
  screenshots?: string[]; collectionIds?: string[];
}
function loadGames(): Game[] { try { if (fs.existsSync(gamesFile)) return JSON.parse(fs.readFileSync(gamesFile, "utf8")); } catch {} return []; }
function saveGames(g: Game[]) { fs.writeFileSync(gamesFile, JSON.stringify(g, null, 2)); }

// ── Collections ───────────────────────────────────────────────────────────────
interface Collection { id: string; name: string; gameIds: string[]; color: string; createdAt: string; }
function loadCollections(): Collection[] { try { if (fs.existsSync(collectionsFile)) return JSON.parse(fs.readFileSync(collectionsFile, "utf8")); } catch {} return []; }
function saveCollections(c: Collection[]) { fs.writeFileSync(collectionsFile, JSON.stringify(c, null, 2)); }

// ── Reviews ───────────────────────────────────────────────────────────────────
interface Review { id: string; gameId: string; userId: string; username: string; avatarColor: string; rating: number; text: string; createdAt: string; }
function loadReviews(): Review[] { try { if (fs.existsSync(reviewsFile)) return JSON.parse(fs.readFileSync(reviewsFile, "utf8")); } catch {} return []; }
function saveReviews(r: Review[]) { fs.writeFileSync(reviewsFile, JSON.stringify(r, null, 2)); }

// ── Mods ─────────────────────────────────────────────────────────────────────
interface Mod { id: string; gameId: string; name: string; path: string; enabled: boolean; addedAt: string; size?: number; }
function loadMods(): Mod[] { try { if (fs.existsSync(modsFile)) return JSON.parse(fs.readFileSync(modsFile, "utf8")); } catch {} return []; }
function saveMods(m: Mod[]) { fs.writeFileSync(modsFile, JSON.stringify(m, null, 2)); }

// ── News ──────────────────────────────────────────────────────────────────────
interface NewsPost { id: string; gameId?: string; authorId: string; authorName: string; authorColor: string; title: string; body: string; createdAt: string; global?: boolean; }
function loadNews(): NewsPost[] { try { if (fs.existsSync(newsFile)) return JSON.parse(fs.readFileSync(newsFile, "utf8")); } catch {} return []; }
function saveNews(n: NewsPost[]) { fs.writeFileSync(newsFile, JSON.stringify(n, null, 2)); }

// ── Achievements ──────────────────────────────────────────────────────────────
const ACHIEVEMENT_DEFS: Record<string, { name: string; desc: string; icon: string; secret?: boolean }> = {
  first_steps:    { name: "First Steps",    desc: "Created your Tevive account",         icon: "star"    },
  first_download: { name: "Downloader",      desc: "Downloaded your first game",          icon: "dl"      },
  first_upload:   { name: "Publisher",       desc: "Uploaded your first game",            icon: "upload"  },
  first_scan:     { name: "Safety First",    desc: "Completed your first clean scan",     icon: "shield"  },
  collector_5:    { name: "Collector",       desc: "Installed 5 games",                   icon: "pack"    },
  collector_10:   { name: "Veteran",         desc: "Installed 10 games",                  icon: "pack2"   },
  curator_5:      { name: "Curator",         desc: "Uploaded 5 games",                    icon: "upload2" },
  admin_unlock:   { name: "Administrator",   desc: "Unlocked admin access",               icon: "admin",  secret: true },
  playtime_1h:    { name: "Gamer",           desc: "Played games for 1 hour total",       icon: "ctrl"    },
  wishlist_5:     { name: "Window Shopper",  desc: "Added 5 games to wishlist",           icon: "heart"   },
  reviewer:       { name: "Critic",          desc: "Wrote your first game review",        icon: "star"    },
  modder:         { name: "Modder",          desc: "Added your first mod",                icon: "pack"    },
  collector_col:  { name: "Organizer",       desc: "Created your first collection",       icon: "pack2"   },
};
interface Achievement { id: string; unlockedAt: string; userId: string; }
function loadAchievements(): Achievement[] { try { if (fs.existsSync(achievementsFile)) return JSON.parse(fs.readFileSync(achievementsFile, "utf8")); } catch {} return []; }
function saveAchievements(a: Achievement[]) { fs.writeFileSync(achievementsFile, JSON.stringify(a, null, 2)); }
function unlockAchievement(userId: string, id: string, win?: BrowserWindow | null): boolean {
  if (!ACHIEVEMENT_DEFS[id]) return false;
  const list = loadAchievements();
  if (list.find(a => a.userId === userId && a.id === id)) return false;
  list.push({ id, unlockedAt: new Date().toISOString(), userId });
  saveAchievements(list);
  if (win) win.webContents.send("achievement-unlocked", { id, ...ACHIEVEMENT_DEFS[id] });
  return true;
}

// ── Friends & Notifications ───────────────────────────────────────────────────
interface FriendEntry { userId: string; friendId: string; addedAt: string; status: "accepted" | "pending"; }
function loadFriends(): FriendEntry[] { try { if (fs.existsSync(friendsFile)) return JSON.parse(fs.readFileSync(friendsFile, "utf8")); } catch {} return []; }
function saveFriends(f: FriendEntry[]) { fs.writeFileSync(friendsFile, JSON.stringify(f, null, 2)); }
interface Notif { id: string; userId: string; type: string; message: string; read: boolean; createdAt: string; }
function loadNotifs(): Notif[] { try { if (fs.existsSync(notifFile)) return JSON.parse(fs.readFileSync(notifFile, "utf8")); } catch {} return []; }
function saveNotifs(n: Notif[]) { fs.writeFileSync(notifFile, JSON.stringify(n, null, 2)); }
function addNotif(userId: string, type: string, message: string) {
  const list = loadNotifs();
  list.unshift({ id: Date.now().toString(), userId, type, message, read: false, createdAt: new Date().toISOString() });
  saveNotifs(list.slice(0, 100));
}

// ── Scan ──────────────────────────────────────────────────────────────────────
interface ScanRecord { id: string; fileName: string; filePath: string; startedAt: string; finishedAt?: string; status: "scanning"|"clean"|"threat"; threats?: string[]; engine: string; gameId?: string; fileSize?: number; }
function loadScans(): ScanRecord[] { try { if (fs.existsSync(scansFile)) return JSON.parse(fs.readFileSync(scansFile, "utf8")); } catch {} return []; }
function saveScans(s: ScanRecord[]) { fs.writeFileSync(scansFile, JSON.stringify(s, null, 2)); }
function clamAvAvailable(): Promise<boolean> { return new Promise(r => exec("clamscan --version", err => r(!err))); }

function runHeuristicScan(filePath: string, onProgress: (pct: number, step: string, checkId: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    const INDICATORS: [string, string][] = [
      ["cmd.exe /c","Trojan: Shell injection"],["powershell -enc","Trojan: Obfuscated PS"],
      ["CreateRemoteThread","Rootkit: Process injection"],["VirtualAllocEx","Rootkit: Memory injection"],
      ["URLDownloadToFile","Trojan: Download dropper"],["bitcoin","Cryptojacker: Crypto ref"],
      ["xmrig","Cryptojacker: XMRig miner"],["YOUR_FILES_ARE_ENCRYPTED","Ransomware: Encryption msg"],
      ["GetAsyncKeyState","Spyware: Keystroke monitoring"],["SetWindowsHookEx","Spyware: Hook install"],
      ["botnet","Botnet: Network bot"],["ZeroAccess","Rootkit: ZeroAccess"],
      ["MBR_WIPER","Wiper: MBR overwrite"],["disk_wipe","Wiper: Disk wipe"],
    ];
    const STEPS: [number, string, string][] = [
      [8,"Reading PE header...","pe"],[20,"Signature analysis...","sig"],[33,"Behavioral analysis...","behav"],
      [46,"Heuristic scan...","heur"],[58,"Network indicators...","net"],[68,"Permission analysis...","perm"],
      [80,"Hash verification...","hash"],[90,"Ransomware patterns...","ransom"],[95,"Rootkit/wiper analysis...","rootkit"],[100,"Done","done"],
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

function runClamScan(filePath: string, onProgress: (pct: number, step: string, checkId: string) => void): Promise<{ clean: boolean; threats: string[] }> {
  return new Promise(resolve => {
    onProgress(5, "Starting ClamAV...", "sig");
    const proc = spawn("clamscan", ["--verbose", "--no-summary", filePath]);
    let output = "", pct = 5;
    proc.stdout.on("data", (c: Buffer) => { output += c.toString(); pct = Math.min(90, pct + 7); onProgress(pct, "ClamAV scanning...", "heur"); });
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

// ── GitHub ────────────────────────────────────────────────────────────────────
async function resolveGithubRelease(url: string): Promise<{ downloadUrl: string; fileName: string; size?: number } | null> {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/\s]+)/);
  if (!match) return null;
  const [, owner, repo, tag] = match;
  return new Promise(resolve => {
    const req = https.get(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
      { headers: { "User-Agent": "Tevive/1.0", "Accept": "application/vnd.github.v3+json" } }, res => {
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

// ── Downloads ─────────────────────────────────────────────────────────────────
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
let mainWin: BrowserWindow | null = null;

function createSplashWindow(): BrowserWindow {
  const s = new BrowserWindow({ width: 500, height: 300, frame: false, resizable: false, center: true, alwaysOnTop: true, skipTaskbar: true, backgroundColor: "#0a0e14", webPreferences: { nodeIntegration: false, contextIsolation: true } });
  s.loadFile(path.join(__dirname, "../build/splash.html")).catch(() => {});
  return s;
}

function createMainWindow(splash: BrowserWindow) {
  const iconPath = path.join(__dirname, "../build/logo.png");
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 640, show: false,
    title: "Tevive", backgroundColor: "#0a0e14", autoHideMenuBar: true,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.js"), nodeIntegration: false, contextIsolation: true },
  });
  mainWin = win;
  nativeTheme.themeSource = "dark";
  win.loadFile(path.join(__dirname, "../build/index.html"));
  win.webContents.on("did-finish-load", () => { splash.destroy(); win.show(); win.focus(); });
  win.webContents.on("did-fail-load", () => { splash.destroy(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.on("page-title-updated", e => e.preventDefault());
}

// ── IPC: Settings ─────────────────────────────────────────────────────────────
ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_e, s: Partial<Settings>) => {
  const updated = { ...loadSettings(), ...s };
  saveSettings(updated as Settings);
  if (updated.downloadDir) ensureDir(updated.downloadDir);
  return updated;
});

// ── IPC: Auth ─────────────────────────────────────────────────────────────────
ipcMain.handle("auth-register", (e, { username, email, password }: { username: string; email: string; password: string }) => {
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return { error: emailCheck.message };
  if (username.length < 3) return { error: "Username must be at least 3 characters" };
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(username)) return { error: "Username: only letters, numbers, _ - ." };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return { error: "Email already registered" };
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return { error: "Username already taken" };
  const salt = generateSalt();
  const user: User = {
    id: Date.now().toString(), username, email: email.trim().toLowerCase(),
    passwordHash: hashPw(password, salt), salt,
    createdAt: new Date().toISOString(), avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    isAdmin: false, isVerified: false, bio: "", status: "online", totalPlaytime: 0, lastSeen: new Date().toISOString(),
  };
  users.push(user); saveUsers(users);
  const win = BrowserWindow.fromWebContents(e.sender);
  unlockAchievement(user.id, "first_steps", win);
  addNotif(user.id, "welcome", "Welcome to Tevive! Explore the store and start downloading games.");
  return { user: sanitizeUserWithEmail(user) };
});

ipcMain.handle("auth-login", (_e, { email, password }: { email: string; password: string }) => {
  const key = email.toLowerCase().trim();
  const rl = checkRateLimit(key);
  if (rl.blocked) return { error: `Too many attempts. Try again in ${rl.remaining} minute(s).` };
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === key);
  if (idx === -1) { recordAttempt(key); return { error: "Email not found" }; }
  const u = users[idx];
  const valid = u.salt ? u.passwordHash === hashPw(password, u.salt) : u.passwordHash === hashPw(password);
  if (!valid) { recordAttempt(key); return { error: "Incorrect password" }; }
  clearAttempts(key);
  if (!u.salt) {
    const salt = generateSalt();
    users[idx].salt = salt;
    users[idx].passwordHash = hashPw(password, salt);
  }
  users[idx].lastSeen = new Date().toISOString();
  users[idx].status = "online";
  saveUsers(users);
  return { user: sanitizeUserWithEmail(users[idx]) };
});

ipcMain.handle("auth-forgot-email", (_e, { username }: { username: string }) => {
  const user = loadUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { error: "Username not found" };
  const [local, domain] = user.email.split("@");
  const ml = local[0] + "*".repeat(Math.max(1, local.length - 2)) + (local.length > 1 ? local[local.length - 1] : "");
  const dp = domain.split(".");
  const md = dp[0][0] + "*".repeat(Math.max(1, dp[0].length - 1)) + "." + dp.slice(1).join(".");
  return { maskedEmail: `${ml}@${md}` };
});

ipcMain.handle("auth-forgot-password", (_e, { email }: { email: string }) => {
  const user = loadUsers().find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (!user) return { error: "No account with that email" };
  return { found: true, username: user.username };
});

ipcMain.handle("auth-reset-password", (_e, { email, newPassword }: { email: string; newPassword: string }) => {
  if (newPassword.length < 8) return { error: "Password must be at least 8 characters" };
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (idx === -1) return { error: "User not found" };
  const salt = generateSalt();
  users[idx].passwordHash = hashPw(newPassword, salt);
  users[idx].salt = salt;
  saveUsers(users);
  return { ok: true };
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
  return { user: sanitizeUserWithEmail(users[idx]) };
});

ipcMain.handle("auth-activate-admin", (e, { userId, code }: { userId: string; code: string }) => {
  if (code !== ADMIN_CODE) return { error: "Invalid admin code" };
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { error: "User not found" };
  if (users[idx].isAdmin) return { alreadyAdmin: true };
  users[idx].isAdmin = true; users[idx].isVerified = true;
  saveUsers(users);
  unlockAchievement(userId, "admin_unlock", BrowserWindow.fromWebContents(e.sender));
  addNotif(userId, "admin", "Admin access activated. You now have full administrative privileges.");
  return { user: sanitizeUserWithEmail(users[idx]) };
});

ipcMain.handle("admin-grant-checkmark", (_e, { adminId, targetUsername }: { adminId: string; targetUsername: string }) => {
  const users = loadUsers();
  if (!users.find(u => u.id === adminId)?.isAdmin) return { error: "Not authorized" };
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername.toLowerCase());
  if (idx === -1) return { error: "User not found" };
  users[idx].isVerified = !users[idx].isVerified;
  saveUsers(users);
  addNotif(users[idx].id, "verified", users[idx].isVerified ? "You have been granted a verified badge." : "Your verified badge has been removed.");
  return { user: sanitizeUserWithEmail(users[idx]), granted: users[idx].isVerified };
});

ipcMain.handle("admin-get-users", (_e, { adminId }: { adminId: string }) => {
  const users = loadUsers();
  if (!users.find(u => u.id === adminId)?.isAdmin) return { error: "Not authorized" };
  return users.map(sanitizeUser);
});

ipcMain.handle("search-users", (_e, { query }: { query: string }) =>
  loadUsers().filter(u => u.username.toLowerCase().includes(query.toLowerCase())).slice(0, 10).map(sanitizeUser));

ipcMain.handle("validate-email-live", (_e, { email }: { email: string }) => validateEmail(email));

// ── IPC: Games ────────────────────────────────────────────────────────────────
ipcMain.handle("get-games", () => loadGames());
ipcMain.handle("add-game", (_e, game: Partial<Game>) => {
  const games = loadGames();
  const g: Game = { title: "", description: "", version: "", tags: [], installed: false, published: false, scanStatus: "pending", addedAt: new Date().toISOString(), id: Date.now().toString(), playtime: 0, isWishlisted: false, downloadCount: 0, ...game };
  games.push(g); saveGames(games); return g;
});
ipcMain.handle("update-game", (_e, id: string, patch: Partial<Game>) => {
  const games = loadGames(); const idx = games.findIndex(g => g.id === id);
  if (idx !== -1) { games[idx] = { ...games[idx], ...patch }; saveGames(games); return games[idx]; }
  return null;
});
ipcMain.handle("delete-game", (_e, id: string) => { saveGames(loadGames().filter(g => g.id !== id)); return true; });
ipcMain.handle("toggle-wishlist", (e, { gameId, userId }: { gameId: string; userId: string }) => {
  const games = loadGames(); const idx = games.findIndex(g => g.id === gameId);
  if (idx === -1) return null;
  games[idx].isWishlisted = !games[idx].isWishlisted; saveGames(games);
  if (games.filter(g => g.isWishlisted).length >= 5) unlockAchievement(userId, "wishlist_5", BrowserWindow.fromWebContents(e.sender));
  return { wishlisted: games[idx].isWishlisted };
});
ipcMain.handle("rate-game", (_e, { gameId, rating }: { gameId: string; rating: number }) => {
  const games = loadGames(); const idx = games.findIndex(g => g.id === gameId);
  if (idx !== -1) { games[idx].rating = Math.max(1, Math.min(5, rating)); saveGames(games); return games[idx].rating; }
  return null;
});
ipcMain.handle("track-playtime", (_e, { gameId, userId, seconds }: { gameId: string; userId: string; seconds: number }) => {
  const games = loadGames(); const gi = games.findIndex(g => g.id === gameId);
  if (gi !== -1) { games[gi].playtime = (games[gi].playtime || 0) + seconds; games[gi].lastPlayed = new Date().toISOString(); saveGames(games); }
  const users = loadUsers(); const ui = users.findIndex(u => u.id === userId);
  if (ui !== -1) { users[ui].totalPlaytime = (users[ui].totalPlaytime || 0) + seconds; saveUsers(users); }
  return true;
});

// ── IPC: Scan ─────────────────────────────────────────────────────────────────
ipcMain.handle("scan-and-publish", async (e, { gameId, filePath }: { gameId: string; filePath: string }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const id = `scan_${Date.now()}`;
  const fileName = path.basename(filePath || gameId);
  if (filePath && fs.existsSync(filePath) && path.extname(filePath).toLowerCase() === ".zip") {
    if (fs.statSync(filePath).size > ZIP_SIZE_LIMIT) {
      const games = loadGames(); const gi = games.findIndex(g => g.id === gameId);
      if (gi !== -1) { games[gi].scanStatus = "threat"; games[gi].threats = ["File exceeds 2 GB ZIP limit"]; saveGames(games); }
      win?.webContents.send("scan-progress", { gameId, id, pct: 100, step: "Rejected", checkId: "done", status: "threat", threats: ["File exceeds 2 GB ZIP limit"], engine: "Size Check" });
      return { status: "threat", threats: ["File exceeds 2 GB ZIP limit"], engine: "Size Check" };
    }
  }
  const g2 = loadGames(); const gIdx = g2.findIndex(g => g.id === gameId);
  if (gIdx !== -1) { g2[gIdx].scanStatus = "scanning"; if (filePath) g2[gIdx].localPath = filePath; saveGames(g2); }
  const scans = loadScans();
  const record: ScanRecord = { id, fileName, filePath: filePath || "", startedAt: new Date().toISOString(), status: "scanning", engine: "Heuristic", gameId, fileSize: filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : undefined };
  scans.unshift(record); saveScans(scans);
  win?.webContents.send("scan-progress", { gameId, id, pct: 0, step: "Starting scanner...", checkId: "sig", status: "scanning" });
  const hasClamAv = await clamAvAvailable();
  if (hasClamAv) record.engine = "ClamAV";
  const onProgress = (pct: number, step: string, checkId: string) => win?.webContents.send("scan-progress", { gameId, id, pct, step, checkId, status: "scanning" });
  const result = hasClamAv ? await runClamScan(filePath || "", onProgress) : await runHeuristicScan(filePath || "", onProgress);
  record.status = result.clean ? "clean" : "threat"; record.threats = result.threats; record.finishedAt = new Date().toISOString();
  const g3 = loadGames(); const gi2 = g3.findIndex(g => g.id === gameId);
  if (gi2 !== -1) { g3[gi2].scanStatus = result.clean ? "clean" : "threat"; g3[gi2].scanEngine = record.engine; g3[gi2].threats = result.threats; if (result.clean) { g3[gi2].published = true; g3[gi2].downloadCount = 0; } saveGames(g3); }
  const allScans = loadScans(); const si = allScans.findIndex(s => s.id === id);
  if (si !== -1) allScans[si] = record; else allScans.unshift(record);
  saveScans(allScans);
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
ipcMain.handle("pick-game-file", async () => { const r = await dialog.showOpenDialog({ title: "Select game file", filters: [{ name: "Game files", extensions: ["exe","zip","rar","msi","7z","bat","cmd"] }], properties: ["openFile"] }); return r.canceled ? null : r.filePaths[0]; });
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

// ── IPC: Achievements ─────────────────────────────────────────────────────────
ipcMain.handle("get-achievements", (_e, { userId }: { userId: string }) => {
  const unlocked = loadAchievements().filter(a => a.userId === userId);
  return Object.entries(ACHIEVEMENT_DEFS)
    .filter(([id, def]) => !def.secret || unlocked.find(a => a.id === id))
    .map(([id, def]) => { const u = unlocked.find(a => a.id === id); return { id, ...def, unlocked: !!u, unlockedAt: u?.unlockedAt }; });
});
ipcMain.handle("unlock-achievement", (e, { userId, achievementId }: { userId: string; achievementId: string }) =>
  unlockAchievement(userId, achievementId, BrowserWindow.fromWebContents(e.sender)));

// ── IPC: Friends & Notifications ──────────────────────────────────────────────
ipcMain.handle("get-friends", (_e, { userId }: { userId: string }) => {
  const friends = loadFriends().filter(f => (f.userId === userId || f.friendId === userId) && f.status === "accepted");
  const users = loadUsers();
  return friends.map(f => { const fid = f.userId === userId ? f.friendId : f.userId; const u = users.find(x => x.id === fid); return u ? { ...sanitizeUser(u), addedAt: f.addedAt } : null; }).filter(Boolean);
});
ipcMain.handle("add-friend", (_e, { userId, targetUsername }: { userId: string; targetUsername: string }) => {
  const users = loadUsers();
  const target = users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
  if (!target) return { error: "User not found" };
  if (target.id === userId) return { error: "Cannot add yourself" };
  const friends = loadFriends();
  if (friends.find(f => (f.userId===userId&&f.friendId===target.id)||(f.userId===target.id&&f.friendId===userId))) return { error: "Already friends" };
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
ipcMain.handle("mark-notifs-read", (_e, { userId }: { userId: string }) => { saveNotifs(loadNotifs().map(n => n.userId === userId ? { ...n, read: true } : n)); return true; });

// ── IPC: Collections ──────────────────────────────────────────────────────────
ipcMain.handle("get-collections", () => loadCollections());
ipcMain.handle("add-collection", (e, { name, color }: { name: string; color: string }) => {
  const cols = loadCollections();
  const c: Collection = { id: Date.now().toString(), name, gameIds: [], color: color || "#1a9fff", createdAt: new Date().toISOString() };
  cols.push(c); saveCollections(cols);
  if (currentUser_workaround) unlockAchievement(currentUser_workaround, "collector_col", null);
  return c;
});
ipcMain.handle("update-collection", (_e, id: string, patch: Partial<Collection>) => {
  const cols = loadCollections(); const idx = cols.findIndex(c => c.id === id);
  if (idx !== -1) { cols[idx] = { ...cols[idx], ...patch }; saveCollections(cols); return cols[idx]; }
  return null;
});
ipcMain.handle("delete-collection", (_e, id: string) => { saveCollections(loadCollections().filter(c => c.id !== id)); return true; });
ipcMain.handle("add-to-collection", (_e, { collectionId, gameId }: { collectionId: string; gameId: string }) => {
  const cols = loadCollections(); const idx = cols.findIndex(c => c.id === collectionId);
  if (idx !== -1 && !cols[idx].gameIds.includes(gameId)) { cols[idx].gameIds.push(gameId); saveCollections(cols); return cols[idx]; }
  return null;
});
ipcMain.handle("remove-from-collection", (_e, { collectionId, gameId }: { collectionId: string; gameId: string }) => {
  const cols = loadCollections(); const idx = cols.findIndex(c => c.id === collectionId);
  if (idx !== -1) { cols[idx].gameIds = cols[idx].gameIds.filter(id => id !== gameId); saveCollections(cols); return cols[idx]; }
  return null;
});

// Workaround to pass userId to add-collection for achievements
let currentUser_workaround: string | null = null;
ipcMain.handle("set-current-user-hint", (_e, userId: string) => { currentUser_workaround = userId; return true; });

// ── IPC: Reviews ──────────────────────────────────────────────────────────────
ipcMain.handle("get-reviews", (_e, { gameId }: { gameId: string }) => loadReviews().filter(r => r.gameId === gameId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()));
ipcMain.handle("add-review", (e, review: Omit<Review, "id"|"createdAt">) => {
  const reviews = loadReviews();
  const existing = reviews.findIndex(r => r.gameId === review.gameId && r.userId === review.userId);
  const r: Review = { id: Date.now().toString(), ...review, createdAt: new Date().toISOString() };
  if (existing !== -1) reviews[existing] = r; else reviews.unshift(r);
  saveReviews(reviews);
  unlockAchievement(review.userId, "reviewer", BrowserWindow.fromWebContents(e.sender));
  return r;
});
ipcMain.handle("delete-review", (_e, { reviewId, userId }: { reviewId: string; userId: string }) => {
  const reviews = loadReviews(); const idx = reviews.findIndex(r => r.id === reviewId && r.userId === userId);
  if (idx === -1) return { error: "Not authorized" };
  saveReviews(reviews.filter(r => r.id !== reviewId)); return { ok: true };
});

// ── IPC: Mods ─────────────────────────────────────────────────────────────────
ipcMain.handle("get-mods", (_e, { gameId }: { gameId: string }) => loadMods().filter(m => m.gameId === gameId));
ipcMain.handle("add-mod", async (e, { gameId }: { gameId: string }) => {
  const r = await dialog.showOpenDialog({ title: "Select mod file", properties: ["openFile"] });
  if (r.canceled || !r.filePaths[0]) return null;
  const modPath = r.filePaths[0];
  const size = fs.existsSync(modPath) ? fs.statSync(modPath).size : 0;
  const mod: Mod = { id: Date.now().toString(), gameId, name: path.basename(modPath), path: modPath, enabled: true, addedAt: new Date().toISOString(), size };
  const mods = loadMods(); mods.push(mod); saveMods(mods);
  unlockAchievement(currentUser_workaround || "", "modder", null);
  return mod;
});
ipcMain.handle("toggle-mod", (_e, { modId }: { modId: string }) => {
  const mods = loadMods(); const idx = mods.findIndex(m => m.id === modId);
  if (idx !== -1) { mods[idx].enabled = !mods[idx].enabled; saveMods(mods); return mods[idx]; }
  return null;
});
ipcMain.handle("delete-mod", (_e, { modId }: { modId: string }) => { saveMods(loadMods().filter(m => m.id !== modId)); return true; });

// ── IPC: News ─────────────────────────────────────────────────────────────────
ipcMain.handle("get-news", (_e, opts: { gameId?: string }) => {
  const news = loadNews();
  return opts?.gameId ? news.filter(n => n.gameId === opts.gameId) : news.slice(0, 30);
});
ipcMain.handle("add-news-post", (_e, post: Omit<NewsPost, "id"|"createdAt">) => {
  const news = loadNews();
  const p: NewsPost = { id: Date.now().toString(), ...post, createdAt: new Date().toISOString() };
  news.unshift(p); saveNews(news); return p;
});
ipcMain.handle("delete-news-post", (_e, { postId, authorId }: { postId: string; authorId: string }) => {
  const news = loadNews(); const idx = news.findIndex(n => n.id === postId && n.authorId === authorId);
  if (idx === -1) return { error: "Not authorized" };
  saveNews(news.filter(n => n.id !== postId)); return { ok: true };
});

// ── IPC: Screenshots ──────────────────────────────────────────────────────────
ipcMain.handle("get-screenshots", (_e, { gameId }: { gameId: string }) => {
  const dir = path.join(userData, "screenshots", gameId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).map(f => path.join(dir, f));
});
ipcMain.handle("add-screenshots", async (_e, { gameId }: { gameId: string }) => {
  const r = await dialog.showOpenDialog({ title: "Add screenshots", filters: [{ name: "Images", extensions: ["png","jpg","jpeg","webp"] }], properties: ["openFile","multiSelections"] });
  if (r.canceled) return [];
  const dir = path.join(userData, "screenshots", gameId);
  ensureDir(dir);
  const copied: string[] = [];
  for (const src of r.filePaths) { const dest = path.join(dir, Date.now() + "_" + path.basename(src)); fs.copyFileSync(src, dest); copied.push(dest); }
  return copied;
});
ipcMain.handle("delete-screenshot", (_e, { path: p }: { path: string }) => { try { fs.unlinkSync(p); return true; } catch { return false; } });

// ── IPC: Backup & Restore ─────────────────────────────────────────────────────
ipcMain.handle("export-backup", async () => {
  const r = await dialog.showSaveDialog({ title: "Save Tevive backup", defaultPath: `tevive-backup-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: "JSON backup", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  const backup = { version: APP_VERSION, exportedAt: new Date().toISOString(), games: loadGames(), collections: loadCollections(), reviews: loadReviews(), mods: loadMods(), news: loadNews(), achievements: loadAchievements(), settings: loadSettings() };
  fs.writeFileSync(r.filePath, JSON.stringify(backup, null, 2));
  return { path: r.filePath };
});
ipcMain.handle("import-backup", async () => {
  const r = await dialog.showOpenDialog({ title: "Open Tevive backup", filters: [{ name: "JSON backup", extensions: ["json"] }], properties: ["openFile"] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const backup = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
    if (backup.games) saveGames(backup.games);
    if (backup.collections) saveCollections(backup.collections);
    if (backup.reviews) saveReviews(backup.reviews);
    if (backup.mods) saveMods(backup.mods);
    if (backup.news) saveNews(backup.news);
    if (backup.achievements) saveAchievements(backup.achievements);
    if (backup.settings) saveSettings({ ...defaultSettings(), ...backup.settings });
    return { ok: true, version: backup.version, exportedAt: backup.exportedAt };
  } catch (e: unknown) { return { error: (e as Error).message }; }
});

// ── IPC: System ───────────────────────────────────────────────────────────────
ipcMain.handle("open-in-folder", (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle("launch-game", async (_e, { path: gamePath, gameId, userId }: { path: string; gameId?: string; userId?: string }) => {
  const result = await shell.openPath(gamePath);
  if (!result && gameId && userId) {
    setTimeout(() => { if (gameId && userId) unlockAchievement(userId, "playtime_1h", null); }, 3600000);
  }
  return result;
});
ipcMain.handle("get-app-version", () => APP_VERSION);
ipcMain.handle("pick-download-folder", async () => { const r = await dialog.showOpenDialog({ title: "Choose download folder", properties: ["openDirectory","createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("pick-screenshots-folder", async () => { const r = await dialog.showOpenDialog({ title: "Choose screenshots folder", properties: ["openDirectory","createDirectory"] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("clear-cache", () => { try { const cacheDir = path.join(userData, "cache"); if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true }); return { cleared: true }; } catch (e: unknown) { return { error: (e as Error).message }; } });
ipcMain.handle("reset-all-data", () => {
  for (const f of [gamesFile, usersFile, scansFile, achievementsFile, friendsFile, notifFile, collectionsFile, reviewsFile, modsFile, newsFile]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
  try { const dir = path.join(userData, "downloads"); if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return { ok: true };
});
ipcMain.handle("detect-steam-games", () => {
  const steamPaths = ["C:\\Program Files (x86)\\Steam\\steamapps\\common","C:\\Program Files\\Steam\\steamapps\\common",path.join(app.getPath("home"),".steam","steam","steamapps","common")];
  const detected: { name: string; path: string }[] = [];
  for (const sp of steamPaths) { try { if (fs.existsSync(sp)) { fs.readdirSync(sp,{withFileTypes:true}).filter(d=>d.isDirectory()).forEach(d=>detected.push({name:d.name,path:path.join(sp,d.name)})); } } catch {} }
  return detected;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  protocol.handle("tevive-local", request => net.fetch("file://" + decodeURIComponent(request.url.replace("tevive-local://", ""))));
  const settings = loadSettings();
  ensureDir(settings.downloadDir); ensureDir(settings.screenshotsDir);
  const splash = createSplashWindow();
  setTimeout(() => createMainWindow(splash), 1200);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) { const s = createSplashWindow(); setTimeout(() => createMainWindow(s), 1200); } });
