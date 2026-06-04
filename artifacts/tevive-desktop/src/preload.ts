import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tevive", {
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,

  // Settings
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s: unknown) => ipcRenderer.invoke("save-settings", s),
  pickDownloadFolder: () => ipcRenderer.invoke("pick-download-folder"),

  // Auth
  register: (d: unknown) => ipcRenderer.invoke("auth-register", d),
  login: (d: unknown) => ipcRenderer.invoke("auth-login", d),
  updateUsername: (d: unknown) => ipcRenderer.invoke("auth-update-username", d),

  // Games
  getGames: () => ipcRenderer.invoke("get-games"),
  addGame: (g: unknown) => ipcRenderer.invoke("add-game", g),
  updateGame: (id: string, patch: unknown) => ipcRenderer.invoke("update-game", id, patch),
  deleteGame: (id: string) => ipcRenderer.invoke("delete-game", id),

  // Upload + scan
  pickThumbnail: () => ipcRenderer.invoke("pick-thumbnail"),
  pickGameFile: () => ipcRenderer.invoke("pick-game-file"),
  resolveGithubRelease: (url: string) => ipcRenderer.invoke("resolve-github-release", url),
  scanAndPublish: (d: unknown) => ipcRenderer.invoke("scan-and-publish", d),
  getScanHistory: () => ipcRenderer.invoke("get-scan-history"),

  // Scan progress listener
  onScanProgress: (cb: (d: unknown) => void) => ipcRenderer.on("scan-progress", (_e, d) => cb(d)),
  offScanProgress: () => ipcRenderer.removeAllListeners("scan-progress"),

  // Downloads
  startDownload: (opts: unknown) => ipcRenderer.invoke("start-download", opts),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  onDownloadProgress: (cb: (d: unknown) => void) => ipcRenderer.on("download-progress", (_e, d) => cb(d)),
  offDownloadProgress: () => ipcRenderer.removeAllListeners("download-progress"),

  // System
  openInFolder: (p: string) => ipcRenderer.invoke("open-in-folder", p),
  launchGame: (p: string) => ipcRenderer.invoke("launch-game", p),
});
