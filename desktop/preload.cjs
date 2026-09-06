const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  if (typeof listener !== "function") return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("containerCheck", {
  desktop: Object.freeze({
    isDesktop: true,
    platform: process.platform,
  }),
  terminal: Object.freeze({
    open: (input) => ipcRenderer.invoke("terminal:open", input),
    write: (input) => ipcRenderer.send("terminal:write", input),
    resize: (input) => ipcRenderer.send("terminal:resize", input),
    close: (input) => ipcRenderer.send("terminal:close", input),
    onData: (listener) => subscribe("terminal:data", listener),
    onState: (listener) => subscribe("terminal:state", listener),
    onExit: (listener) => subscribe("terminal:exit", listener),
  }),
});
