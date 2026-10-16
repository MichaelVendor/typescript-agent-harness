"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// CommonJS on purpose: Electron's sandboxed preload does not load ESM when package.json has "type": "module".
contextBridge.exposeInMainWorld("tahWelcome", {
  list: () => ipcRenderer.invoke("welcome:list"),
  openFolder: () => ipcRenderer.invoke("welcome:open-folder"),
  newProject: () => ipcRenderer.invoke("welcome:new-project"),
  open: (folder) => ipcRenderer.invoke("welcome:open", folder),
});
