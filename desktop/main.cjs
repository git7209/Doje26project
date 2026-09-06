const { app, BrowserWindow, dialog, session } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");
const { DockerEngine } = require("../docker-engine");
const { registerTerminalIpc, sendTerminalEvent } = require("./ipc/register-terminal-ipc.cjs");
const { DockerRuntimeDetector } = require("./runtime/detect-docker-runtime.cjs");
const { createWslDockerConnectionFactory } = require("./runtime/wsl-docker-socket.cjs");
const { PtyTransport } = require("./terminal/pty-transport.cjs");
const { TerminalSessionManager } = require("./terminal/terminal-session-manager.cjs");

const desktopToken = crypto.randomBytes(32).toString("base64url");
const smokeTest = process.env.CONTAINER_CHECK_SMOKE_TEST === "1";
let backendServer;
let appOrigin;
let mainWindow;
let terminalManager;
let selectedRuntime;
const runtimeDetector = new DockerRuntimeDetector();

function engineForRuntime(runtime) {
  if (runtime?.kind === "wsl") {
    return new DockerEngine({
      connectionFactory: createWslDockerConnectionFactory({ distro: runtime.distro }),
      timeoutMs: 8000,
    });
  }
  return new DockerEngine();
}

async function startBackend() {
  process.env.CONTAINER_CHECK_DESKTOP_TOKEN = desktopToken;
  process.env.CONTAINER_CHECK_DATA_DIR = app.getPath("userData");

  const backend = require("../server");
  try {
    selectedRuntime = await runtimeDetector.detect();
    backend.configureDockerRuntime(engineForRuntime(selectedRuntime), selectedRuntime.label);
  } catch {
    backend.configureDockerRuntime(engineForRuntime(null), "Docker Engine");
  }
  ({ server: backendServer } = backend);
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

function registerTerminalBridge() {
  terminalManager = new TerminalSessionManager({
    createTransport: async () => new PtyTransport({
      runtime: selectedRuntime || await runtimeDetector.detect(),
      cwd: app.getPath("home"),
    }),
    sendEvent: sendTerminalEvent,
  });
  registerTerminalIpc({
    manager: terminalManager,
    isAllowedSender: (frame) => Boolean(frame && isAppUrl(frame.url)),
  });
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
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(
          "fetch('/api/health').then(async (response) => ({ status: response.status, body: await response.json() }))",
        );
        if (result.status !== 200 || result.body?.ok !== true) {
          throw new Error(`Backend health check failed (${result.status})`);
        }
        console.log(`Desktop smoke test passed (${result.body.runtime}).`);
        app.exit(0);
      } catch (error) {
        console.error(`Desktop smoke test failed: ${error.message}`);
        app.exit(1);
      }
    });
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
      registerTerminalBridge();
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
    terminalManager?.closeAll("app_exit");
    void closeBackend();
  });
}
