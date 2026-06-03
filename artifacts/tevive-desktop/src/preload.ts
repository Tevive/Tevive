import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tevive", {
  getVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,
});
