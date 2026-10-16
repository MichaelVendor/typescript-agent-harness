import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, StartError, type Server } from "./server.js";
import { loadShellEnv } from "./shell-env.js";
import { listProjects, writeLastFolder } from "./state.js";

const home = os.homedir();
const here = path.dirname(fileURLToPath(import.meta.url));
const node = path.join(process.resourcesPath, "node", "bin", "node");
const cli = path.join(process.resourcesPath, "tah", "dist", "cli.js");
const welcomeHtml = path.join(here, "..", "welcome", "index.html");
/** CJS: sandboxed preload cannot load ESM under package.json `"type": "module"`. */
const preloadJs = path.join(here, "..", "welcome", "preload.cjs");

let env: NodeJS.ProcessEnv = process.env;
let server: Server | undefined;
let starting: Promise<Server | undefined> | undefined;
let win: BrowserWindow | undefined;
/** `welcome` while on the local welcome page; otherwise the serve origin. */
let surface: "welcome" | string = "welcome";
let quitting = false;
let shuttingDown = false;
let stopped = false;
let launching = false;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** stderr is invisible when the app is opened from the Dock, so also append to ~/Library/Logs/tah/main.log. */
function log(line: string): void {
  console.error(line);
  try {
    const dir = app.getPath("logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "main.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never break the app.
  }
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function ensureWindow(): BrowserWindow {
  if (win) return win;
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "tah",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadJs,
    },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => {
    if (surface === "welcome") {
      event.preventDefault();
      return;
    }
    if (new URL(event.url).origin === surface) return;
    event.preventDefault();
    openExternal(event.url);
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  return win;
}

function showWelcome(): void {
  surface = "welcome";
  void ensureWindow().loadFile(welcomeHtml);
  showWindow();
}

function loadWorkbench(url: string): void {
  surface = new URL(url).origin;
  void ensureWindow().loadURL(url);
  showWindow();
}

async function pickFolder(kind: "open" | "new"): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(ensureWindow(), {
    title: kind === "new" ? "New project — choose or create a folder" : "Open folder",
    buttonLabel: kind === "new" ? "Create / Open" : "Open",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
}

/** Starts tah in `folder`, offering Retry / Quit until it starts or the user quits. */
async function launch(folder: string): Promise<boolean> {
  if (launching) return false;
  launching = true;
  try {
    for (;;) {
      let started: Server;
      try {
        const pending = startServer({ node, cli, cwd: folder, env, onExit: (stderr) => void crashed(folder, stderr) });
        starting = pending.then(
          (s) => s,
          () => undefined,
        );
        started = await pending;
      } catch (err) {
        starting = undefined;
        if (quitting) return false;
        const { response } = await dialog.showMessageBox(ensureWindow(), {
          type: "error",
          message: `tah failed to start: ${message(err)}`,
          detail: err instanceof StartError ? err.stderr : "",
          buttons: ["Retry", "Back", "Quit"],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 2) {
          app.quit();
          return false;
        }
        if (response === 1) {
          showWelcome();
          return false;
        }
        continue;
      }
      starting = undefined;
      server = started;
      if (quitting) return false;
      writeLastFolder(home, folder);
      loadWorkbench(started.url);
      return true;
    }
  } finally {
    launching = false;
  }
}

async function stopServer(): Promise<void> {
  const pendingStart = starting;
  const running = server ?? (pendingStart ? await pendingStart : undefined);
  server = undefined;
  starting = undefined;
  if (running) await running.stop();
}

async function goWelcome(): Promise<void> {
  if (quitting || shuttingDown) return;
  if (surface === "welcome" && !server && !starting) {
    showWelcome();
    return;
  }
  const running = server;
  if (running) {
    try {
      const active = await running.activeFolder();
      if (active) writeLastFolder(home, active);
    } catch (err) {
      log(`[desktop] could not save the last folder: ${message(err)}`);
    }
  }
  await stopServer();
  if (quitting) return;
  showWelcome();
}

async function openPicked(kind: "open" | "new"): Promise<{ ok: boolean }> {
  const folder = await pickFolder(kind);
  if (!folder) return { ok: false };
  const ok = await launch(folder);
  return { ok };
}

async function crashed(folder: string, stderr: string): Promise<void> {
  server = undefined;
  if (quitting) return;
  const { response } = await dialog.showMessageBox(ensureWindow(), {
    type: "error",
    message: "tah stopped unexpectedly",
    detail: stderr,
    buttons: ["Restart", "Welcome", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 2) app.quit();
  else if (response === 1) showWelcome();
  else await launch(folder);
}

function installMenu(): void {
  const isMac = process.platform === "darwin";
  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "Welcome",
        accelerator: "CmdOrCtrl+Shift+W",
        click: () => void goWelcome(),
      },
      {
        label: "Open Folder…",
        accelerator: "CmdOrCtrl+O",
        click: () => void openPicked("open"),
      },
      {
        label: "New Project…",
        accelerator: "CmdOrCtrl+N",
        click: () => void openPicked("new"),
      },
      { type: "separator" },
      isMac ? { role: "close" } : { role: "quit" },
    ],
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      fileMenu,
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
}

function installIpc(): void {
  ipcMain.handle("welcome:list", () => listProjects(home));
  ipcMain.handle("welcome:open-folder", () => openPicked("open"));
  ipcMain.handle("welcome:new-project", () => openPicked("new"));
  ipcMain.handle("welcome:open", async (_event, folder: unknown) => {
    if (typeof folder !== "string" || !folder) throw new Error("missing folder");
    const ok = await launch(folder);
    return { ok };
  });
}

async function boot(): Promise<void> {
  installMenu();
  installIpc();
  const shellEnvPromise = loadShellEnv();
  showWelcome();
  const shellEnv = await shellEnvPromise;
  if (quitting) return;
  if (shellEnv.error) log(`[desktop] using the app's environment — login shell: ${shellEnv.error}`);
  env = shellEnv.env;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("activate", () => {
    if (!win) showWelcome();
    else showWindow();
  });
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
          log(`[desktop] could not save the last folder: ${message(err)}`);
        }
        await running.stop();
      }
      stopped = true;
      app.quit();
    })();
  });
  void app.whenReady().then(boot);
}
