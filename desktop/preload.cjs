const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("containerCheck", {
  desktop: Object.freeze({
    isDesktop: true,
    platform: process.platform,
  }),
});

