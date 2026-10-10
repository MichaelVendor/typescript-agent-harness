import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { CliFlags } from "../args.js";
import { createChatHost } from "../host.js";
import { createServeHandler } from "./http.js";
import { createHub } from "./hub.js";

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
): Promise<{ url: string; readonly sessionId: string; stop(): Promise<void> }> {
  const host = await createChatHost(flags, { historyTurns: Infinity });
  const hub = createHub(host);
  const token = randomBytes(32).toString("base64url");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  const { handle, closeAll } = createServeHandler({
    host,
    hub,
    token,
    info: {
      approve: host.approve,
      maxSteps: Number.isFinite(flags.maxSteps) ? flags.maxSteps : null,
      version: pkg.version,
      vision: flags.vision,
    },
    webDir: fileURLToPath(new URL("../web/", import.meta.url)),
    persist: flags.persist,
  });
  const server = createServer(handle);
  let port: number;
  try {
    await host.open();
    port = await listen(server, flags.port);
  } catch (err) {
    await host.close();
    throw err;
  }
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    get sessionId() {
      return host.sessionId;
    },
    async stop() {
      host.cancel();
      closeAll();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await host.close();
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
    console.log(`[tah] session ${serve.sessionId} saved — continue with: tah chat --session ${serve.sessionId}`);
  }
}
