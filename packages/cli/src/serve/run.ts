import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliFlags } from "../args.js";
import { createChatHost } from "../host.js";
import { readSavedSessions } from "../runtime.js";
import { createServeHandler } from "./http.js";
import { createHub } from "./hub.js";
import { createWorkspaces, type Workspaces } from "./workspaces.js";

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new Error(`tah: port ${port} in use — pass --port <n>`) : err);
    });
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => console.log("[tah] could not open a browser — open the link above yourself"));
  child.unref();
}

/** Starts the server and resolves once it is listening; `stop()` shuts everything down. */
export async function startServe(
  flags: CliFlags,
  opts: { homeDir?: string } = {},
): Promise<{ url: string; readonly sessionId: string; readonly cwd: string; stop(): Promise<void> }> {
  const home = opts.homeDir ?? os.homedir();
  const hostFor = (cwd: string) =>
    createChatHost({ ...flags, cwd, session: "" }, { historyTurns: Infinity, homeDir: home });
  const host = await createChatHost(flags, { historyTurns: Infinity, homeDir: home });
  const hub = createHub(host);
  const token = randomBytes(32).toString("base64url");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  let workspaces: Workspaces;
  let closeAll: () => void;
  let server: Server;
  let port: number;
  try {
    await host.open();
    workspaces = createWorkspaces({ cwd: flags.cwd, home, host, hub, createHost: hostFor, readSessions: readSavedSessions });
    const handler = createServeHandler({
      workspaces,
      hub,
      token,
      info: {
        approve: host.approve,
        maxSteps: Number.isFinite(flags.maxSteps) ? flags.maxSteps : null,
        version: pkg.version,
        vision: flags.vision,
        desktop: existsSync(path.join(home, "Desktop")) ? path.join(home, "Desktop") : home,
      },
      webDir: fileURLToPath(new URL("../web/", import.meta.url)),
      persist: flags.persist,
      home,
    });
    closeAll = handler.closeAll;
    server = createServer(handler.handle);
    port = await listen(server, flags.port);
  } catch (err) {
    await host.close();
    throw err;
  }
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    get sessionId() {
      return workspaces.host.sessionId;
    },
    get cwd() {
      return workspaces.cwd;
    },
    async stop() {
      workspaces.host.cancel();
      closeAll();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await workspaces.close();
    },
  };
}

export async function runServe(flags: CliFlags): Promise<void> {
  const serve = await startServe(flags);
  console.log(`[tah] serving ${flags.cwd} — Ctrl+C to stop`);
  console.log(`[tah] open ${serve.url}`);
  if (flags.open) openBrowser(serve.url);
  await new Promise((resolve) => process.once("SIGINT", resolve));
  process.once("SIGINT", () => process.exit(130));
  console.log("\n[tah] stopping…");
  await serve.stop();
  if (flags.persist && !flags.quiet) {
    const cwdArg = serve.cwd === path.resolve(flags.cwd) ? "" : ` --cwd ${JSON.stringify(serve.cwd)}`;
    console.log(`[tah] session ${serve.sessionId} saved — continue with: tah chat${cwdArg} --session ${serve.sessionId}`);
  }
}
