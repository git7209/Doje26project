const { app, BrowserWindow, dialog, session } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");

const desktopToken = crypto.randomBytes(32).toString("base64url");
const smokeTest = process.env.CONTAINER_CHECK_SMOKE_TEST === "1";
let backendServer;
let appOrigin;
let mainWindow;

function startBackend() {
  process.env.CONTAINER_CHECK_DESKTOP_TOKEN = desktopToken;
  process.env.CONTAINER_CHECK_DATA_DIR = app.getPath("userData");

  ({ server: backendServer } = require("../server"));
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      backendServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      backendServer.off("error", onError);
      const address = backendServer.address();
      appOrigin = `http://127.0.0.1:${address.port}`;
      resolve();
    };
    backendServer.once("error", onError);
    backendServer.once("listening", onListening);
    backendServer.listen(0, "127.0.0.1");
  });
}

function registerRequestGuard() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${appOrigin}/api/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          "X-Container-Check-Token": desktopToken,
        },
      });
    },
  );
}

function isAppUrl(value) {
  try {
    return new URL(value).origin === appOrigin;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#111827",
    title: "Container Check",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAppUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow?.show();
  });
  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", () => app.exit(0));
    mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
      console.error(`Desktop smoke test failed (${code}): ${description}`);
      app.exit(1);
    });
  }
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(appOrigin);
}

async function closeBackend() {
  if (!backendServer?.listening) return;
  await new Promise((resolve) => backendServer.close(resolve));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("dev.containercheck.desktop");
    try {
      await startBackend();
      registerRequestGuard();
      createWindow();
    } catch (error) {
      dialog.showErrorBox(
        "Container Check를 시작할 수 없습니다",
        error?.message || "내부 서비스를 시작하지 못했습니다.",
      );
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appOrigin) createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void closeBackend();
  });
}
