const { ipcMain, webContents } = require("electron");
const { TerminalError } = require("../terminal/terminal-errors.cjs");

function publicError(error) {
  if (error instanceof TerminalError) return { code: error.code, message: error.message };
  return { code: "TERMINAL_ERROR", message: "터미널 요청을 처리하지 못했습니다." };
}

function registerTerminalIpc(options) {
  const { manager, isAllowedSender } = options;
  const assertSender = (event) => {
    if (!isAllowedSender(event.senderFrame)) {
      throw new TerminalError("UNAUTHORIZED_IPC", "허용되지 않은 앱 요청입니다.");
    }
    return event.sender.id;
  };

  ipcMain.handle("terminal:open", async (event, input) => {
    try {
      return { ok: true, session: await manager.open(assertSender(event), input) };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  });

  ipcMain.on("terminal:write", (event, input) => {
    try { manager.write(assertSender(event), input); } catch {}
  });
  ipcMain.on("terminal:resize", (event, input) => {
    try { manager.resize(assertSender(event), input); } catch {}
  });
  ipcMain.on("terminal:close", (event, input) => {
    try { manager.close(assertSender(event), input?.sessionId); } catch {}
  });

  return () => {
    ipcMain.removeHandler("terminal:open");
    ipcMain.removeAllListeners("terminal:write");
    ipcMain.removeAllListeners("terminal:resize");
    ipcMain.removeAllListeners("terminal:close");
  };
}

function sendTerminalEvent(ownerId, channel, payload) {
  const target = webContents.fromId(ownerId);
  if (target && !target.isDestroyed()) target.send(channel, payload);
}

module.exports = { publicError, registerTerminalIpc, sendTerminalEvent };

