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
  resetAllData: () => ipcRenderer.invoke("reset-all-data"),

  // Auth
  register: (d: unknown) => ipcRenderer.invoke("auth-register", d),
  login: (d: unknown) => ipcRenderer.invoke("auth-login", d),
  forgotEmail: (d: unknown) => ipcRenderer.invoke("auth-forgot-email", d),
  forgotPassword: (d: unknown) => ipcRenderer.invoke("auth-forgot-password", d),
  resetPassword: (d: unknown) => ipcRenderer.invoke("auth-reset-password", d),
  updateProfile: (d: unknown) => ipcRenderer.invoke("auth-update-profile", d),
  activateAdmin: (d: unknown) => ipcRenderer.invoke("auth-activate-admin", d),
  adminGrantCheckmark: (d: unknown) => ipcRenderer.invoke("admin-grant-checkmark", d),
  adminGetUsers: (d: unknown) => ipcRenderer.invoke("admin-get-users", d),
  searchUsers: (d: unknown) => ipcRenderer.invoke("search-users", d),
  validateEmailLive: (d: unknown) => ipcRenderer.invoke("validate-email-live", d),
  setCurrentUserHint: (userId: string) => ipcRenderer.invoke("set-current-user-hint", userId),

  // Games
  getGames: () => ipcRenderer.invoke("get-games"),
  addGame: (g: unknown) => ipcRenderer.invoke("add-game", g),
  updateGame: (id: string, patch: unknown) => ipcRenderer.invoke("update-game", id, patch),
  deleteGame: (id: string) => ipcRenderer.invoke("delete-game", id),
  toggleWishlist: (d: unknown) => ipcRenderer.invoke("toggle-wishlist", d),
  rateGame: (d: unknown) => ipcRenderer.invoke("rate-game", d),
  trackPlaytime: (d: unknown) => ipcRenderer.invoke("track-playtime", d),

  // Upload & scan
  pickThumbnail: () => ipcRenderer.invoke("pick-thumbnail"),
  pickGameFile: () => ipcRenderer.invoke("pick-game-file"),
  resolveGithubRelease: (url: string) => ipcRenderer.invoke("resolve-github-release", url),
  scanAndPublish: (d: unknown) => ipcRenderer.invoke("scan-and-publish", d),
  getScanHistory: () => ipcRenderer.invoke("get-scan-history"),

  onScanProgress: (cb: (d: unknown) => void) => ipcRenderer.on("scan-progress", (_e, d) => cb(d)),
  offScanProgress: () => ipcRenderer.removeAllListeners("scan-progress"),

  // Downloads
  startDownload: (opts: unknown) => ipcRenderer.invoke("start-download", opts),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  onDownloadProgress: (cb: (d: unknown) => void) => ipcRenderer.on("download-progress", (_e, d) => cb(d)),
  offDownloadProgress: () => ipcRenderer.removeAllListeners("download-progress"),

  // Achievements
  getAchievements: (d: unknown) => ipcRenderer.invoke("get-achievements", d),
  unlockAchievement: (d: unknown) => ipcRenderer.invoke("unlock-achievement", d),
  onAchievementUnlocked: (cb: (d: unknown) => void) => ipcRenderer.on("achievement-unlocked", (_e, d) => cb(d)),

  // Friends & Notifications
  getFriends: (d: unknown) => ipcRenderer.invoke("get-friends", d),
  addFriend: (d: unknown) => ipcRenderer.invoke("add-friend", d),
  removeFriend: (d: unknown) => ipcRenderer.invoke("remove-friend", d),
  getNotifications: (d: unknown) => ipcRenderer.invoke("get-notifications", d),
  markNotifsRead: (d: unknown) => ipcRenderer.invoke("mark-notifs-read", d),

  // Collections
  getCollections: () => ipcRenderer.invoke("get-collections"),
  addCollection: (d: unknown) => ipcRenderer.invoke("add-collection", d),
  updateCollection: (id: string, patch: unknown) => ipcRenderer.invoke("update-collection", id, patch),
  deleteCollection: (id: string) => ipcRenderer.invoke("delete-collection", id),
  addToCollection: (d: unknown) => ipcRenderer.invoke("add-to-collection", d),
  removeFromCollection: (d: unknown) => ipcRenderer.invoke("remove-from-collection", d),

  // Reviews
  getReviews: (d: unknown) => ipcRenderer.invoke("get-reviews", d),
  addReview: (d: unknown) => ipcRenderer.invoke("add-review", d),
  deleteReview: (d: unknown) => ipcRenderer.invoke("delete-review", d),

  // Mods
  getMods: (d: unknown) => ipcRenderer.invoke("get-mods", d),
  addMod: (d: unknown) => ipcRenderer.invoke("add-mod", d),
  toggleMod: (d: unknown) => ipcRenderer.invoke("toggle-mod", d),
  deleteMod: (d: unknown) => ipcRenderer.invoke("delete-mod", d),

  // News
  getNews: (d: unknown) => ipcRenderer.invoke("get-news", d),
  addNewsPost: (d: unknown) => ipcRenderer.invoke("add-news-post", d),
  deleteNewsPost: (d: unknown) => ipcRenderer.invoke("delete-news-post", d),

  // Screenshots
  getScreenshots: (d: unknown) => ipcRenderer.invoke("get-screenshots", d),
  addScreenshots: (d: unknown) => ipcRenderer.invoke("add-screenshots", d),
  deleteScreenshot: (d: unknown) => ipcRenderer.invoke("delete-screenshot", d),

  // Backup
  exportBackup: () => ipcRenderer.invoke("export-backup"),
  importBackup: () => ipcRenderer.invoke("import-backup"),

  // System
  openInFolder: (p: string) => ipcRenderer.invoke("open-in-folder", p),
  launchGame: (d: unknown) => ipcRenderer.invoke("launch-game", d),
  detectSteamGames: () => ipcRenderer.invoke("detect-steam-games"),
});
