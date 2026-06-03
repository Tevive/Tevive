import { app, BrowserWindow, shell, ipcMain, nativeTheme } from "electron";
import path from "path";
import { autoUpdater } from "electron-updater";

const isDev = process.env.NODE_ENV === "development";

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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splash.loadFile(path.join(__dirname, "../build/splash.html"));
  return splash;
}

function createMainWindow(splash: BrowserWindow): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Tevive",
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "../build/icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  });

  nativeTheme.themeSource = "dark";

  // Load the bundled frontend — runs entirely on this PC, no external server needed
  win.loadFile(path.join(__dirname, "../build/index.html"));

  win.webContents.on("did-finish-load", () => {
    splash.destroy();
    win.show();
    win.focus();
    if (!isDev) autoUpdater.checkForUpdatesAndNotify();
  });

  win.webContents.on("did-fail-load", (_e, _code, desc) => {
    splash.destroy();
    win.show();
    win.webContents.loadFile(path.join(__dirname, "../build/error.html"));
    console.error("Failed to load Tevive:", desc);
  });

  // Open external links in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("page-title-updated", (e) => e.preventDefault());
}

app.whenReady().then(() => {
  const splash = createSplashWindow();
  setTimeout(() => createMainWindow(splash), 1200);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const splash = createSplashWindow();
    setTimeout(() => createMainWindow(splash), 1200);
  }
});

ipcMain.handle("get-app-version", () => app.getVersion());
