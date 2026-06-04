import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tevive", {
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,

  // Settings
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s: unknown) => ipcRenderer.invoke("save-settings", s),
  pickDownloadFolder: () => ipcRenderer.invoke("pick-download-folder"),
  pickScreenshotsFolder: () => ipcRenderer.invoke("pick-screenshots-folder"),
  clearCache: () => ipcRenderer.invoke("clear-cache"),

  // Auth
  register: (d: unknown) => ipcRenderer.invoke("auth-register", d),
  login: (d: unknown) => ipcRenderer.invoke("auth-login", d),
  updateProfile: (d: unknown) => ipcRenderer.invoke("auth-update-profile", d),
  activateAdmin: (d: unknown) => ipcRenderer.invoke("auth-activate-admin", d),
  adminGrantCheckmark: (d: unknown) => ipcRenderer.invoke("admin-grant-checkmark", d),
  adminGetUsers: (d: unknown) => ipcRenderer.invoke("admin-get-users", d),
  searchUsers: (d: unknown) => ipcRenderer.invoke("search-users", d),

  // Games
  getGames: () => ipcRenderer.invoke("get-games"),
  addGame: (g: unknown) => ipcRenderer.invoke("add-game", g),
  updateGame: (id: string, patch: unknown) => ipcRenderer.invoke("update-game", id, patch),
  deleteGame: (id: string) => ipcRenderer.invoke("delete-game", id),
  toggleWishlist: (d: unknown) => ipcRenderer.invoke("toggle-wishlist", d),
  rateGame: (d: unknown) => ipcRenderer.invoke("rate-game", d),
  trackPlaytime: (d: unknown) => ipcRenderer.invoke("track-playtime", d),

  // Upload + scan
  pickThumbnail: () => ipcRenderer.invoke("pick-thumbnail"),
  pickGameFile: () => ipcRenderer.invoke("pick-game-file"),
  resolveGithubRelease: (url: string) => ipcRenderer.invoke("resolve-github-release", url),
  scanAndPublish: (d: unknown) => ipcRenderer.invoke("scan-and-publish", d),
  getScanHistory: () => ipcRenderer.invoke("get-scan-history"),

  // Scan progress
  onScanProgress: (cb: (d: unknown) => void) => ipcRenderer.on("scan-progress", (_e, d) => cb(d)),
  offScanProgress: () => ipcRenderer.removeAllListeners("scan-progress"),

  // Downloads
  startDownload: (opts: unknown) => ipcRenderer.invoke("start-download", opts),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  onDownloadProgress: (cb: (d: unknown) => void) => ipcRenderer.on("download-progress", (_e, d) => cb(d)),
  offDownloadProgress: () => ipcRenderer.removeAllListeners("download-progress"),

  // Achievements & social
  getAchievements: (d: unknown) => ipcRenderer.invoke("get-achievements", d),
  unlockAchievement: (d: unknown) => ipcRenderer.invoke("unlock-achievement", d),
  onAchievementUnlocked: (cb: (d: unknown) => void) => ipcRenderer.on("achievement-unlocked", (_e, d) => cb(d)),

  getFriends: (d: unknown) => ipcRenderer.invoke("get-friends", d),
  addFriend: (d: unknown) => ipcRenderer.invoke("add-friend", d),
  removeFriend: (d: unknown) => ipcRenderer.invoke("remove-friend", d),
  getNotifications: (d: unknown) => ipcRenderer.invoke("get-notifications", d),
  markNotifsRead: (d: unknown) => ipcRenderer.invoke("mark-notifs-read", d),

  // System
  openInFolder: (p: string) => ipcRenderer.invoke("open-in-folder", p),
  launchGame: (d: unknown) => ipcRenderer.invoke("launch-game", d),
  detectSteamGames: () => ipcRenderer.invoke("detect-steam-games"),
});
