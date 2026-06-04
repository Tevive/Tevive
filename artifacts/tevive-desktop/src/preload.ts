import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tevive", {
  // App info
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  getDownloadsDir: () => ipcRenderer.invoke("get-downloads-dir"),
  platform: process.platform,

  // Games
  getGames: () => ipcRenderer.invoke("get-games"),
  addGame: (game: unknown) => ipcRenderer.invoke("add-game", game),
  updateGame: (id: string, patch: unknown) => ipcRenderer.invoke("update-game", id, patch),
  deleteGame: (id: string) => ipcRenderer.invoke("delete-game", id),

  // File pickers
  pickThumbnail: () => ipcRenderer.invoke("pick-thumbnail"),
  pickFileToScan: () => ipcRenderer.invoke("pick-file-to-scan"),

  // GitHub Release
  resolveGithubRelease: (url: string) => ipcRenderer.invoke("resolve-github-release", url),

  // Downloads
  startDownload: (opts: unknown) => ipcRenderer.invoke("start-download", opts),
  cancelDownload: (id: string) => ipcRenderer.invoke("cancel-download", id),
  getActiveDownloads: () => ipcRenderer.invoke("get-active-downloads"),
  onDownloadProgress: (cb: (data: unknown) => void) => {
    ipcRenderer.on("download-progress", (_e, data) => cb(data));
  },
  offDownloadProgress: () => {
    ipcRenderer.removeAllListeners("download-progress");
  },

  // Scanner
  scanFile: (filePath: string) => ipcRenderer.invoke("scan-file", filePath),
  getScanHistory: () => ipcRenderer.invoke("get-scan-history"),
  onScanUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on("scan-update", (_e, data) => cb(data));
  },
  offScanUpdate: () => {
    ipcRenderer.removeAllListeners("scan-update");
  },

  // System
  openInFolder: (filePath: string) => ipcRenderer.invoke("open-in-folder", filePath),
  launchGame: (filePath: string) => ipcRenderer.invoke("launch-game", filePath),
});
