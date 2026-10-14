import { app, BrowserWindow, dialog, shell } from "electron";
import os from "node:os";
import path from "node:path";
import { startServer, StartError, type Server } from "./server.js";
import { loadShellEnv } from "./shell-env.js";
import { readLastFolder, writeLastFolder } from "./state.js";

const home = os.homedir();
const node = path.join(process.resourcesPath, "node", "bin", "node");
const cli = path.join(process.resourcesPath, "tah", "dist", "cli.js");

let env: NodeJS.ProcessEnv = process.env;
let server: Server | undefined;
let starting: Promise<Server | undefined> | undefined;
let win: BrowserWindow | undefined;
let origin = "";
let quitting = false;
let shuttingDown = false;
let stopped = false;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function load(url: string): void {
  origin = new URL(url).origin;
  if (!win) {
    win = new BrowserWindow({
      width: 1280,
      height: 840,
      title: "tah",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      openExternal(target);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event) => {
      if (new URL(event.url).origin === origin) return;
      event.preventDefault();
      openExternal(event.url);
    });
    win.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      win?.hide();
    });
  }
  void win.loadURL(url);
  showWindow();
}

async function pickFolder(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Choose a folder for tah",
    buttonLabel: "Open",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
}

/** Starts tah in `folder`, offering Retry / Quit until it starts or the user quits. */
async function launch(folder: string): Promise<void> {
  for (;;) {
    let started: Server;
    try {
      const pending = startServer({ node, cli, cwd: folder, env, onExit: (stderr) => void crashed(folder, stderr) });
      starting = pending.then((s) => s, () => undefined);
      started = await pending;
    } catch (err) {
      starting = undefined;
      if (quitting) return;
      const { response } = await dialog.showMessageBox({
        type: "error",
        message: `tah failed to start: ${message(err)}`,
        detail: err instanceof StartError ? err.stderr : "",
        buttons: ["Retry", "Quit"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 1) {
        app.quit();
        return;
      }
      continue;
    }
    starting = undefined;
    server = started;
    if (quitting) return;
    writeLastFolder(home, folder);
    load(started.url);
    return;
  }
}

async function crashed(folder: string, stderr: string): Promise<void> {
  server = undefined;
  if (quitting) return;
  const { response } = await dialog.showMessageBox({
    type: "error",
    message: "tah stopped unexpectedly",
    detail: stderr,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 1) app.quit();
  else await launch(folder);
}

async function boot(): Promise<void> {
  const shellEnv = await loadShellEnv();
  if (shellEnv.error) console.error(`[desktop] using the app's environment — login shell: ${shellEnv.error}`);
  env = shellEnv.env;
  const folder = readLastFolder(home) ?? (await pickFolder());
  if (!folder) {
    app.quit();
    return;
  }
  await launch(folder);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  // The window only hides; keep running until ⌘Q.
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    quitting = true;
    const pendingStart = starting;
    if (stopped || (!server && !pendingStart)) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      const running = server ?? (await pendingStart);
      if (running) {
        const active = await running.activeFolder();
        try {
          if (active) writeLastFolder(home, active);
        } catch (err) {
          console.error(`[desktop] could not save the last folder: ${message(err)}`);
        }
        await running.stop();
      }
      stopped = true;
      app.quit();
    })();
  });
  void app.whenReady().then(boot);
}
