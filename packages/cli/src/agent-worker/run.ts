import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import type { CliFlags } from "../args.js";
import { createChatHost, type ChatHost } from "../host.js";
import { createAgentWorkerHandler } from "./http.js";

export type AgentWorkerOptions = {
  token: string;
  flags: CliFlags;
  homeDir?: string;
};

const BIND = "127.0.0.1";

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, BIND, () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startAgentWorker(
  opts: AgentWorkerOptions,
): Promise<{ url: string; host: ChatHost; stop(): Promise<void> }> {
  const host = await createChatHost(opts.flags, { historyTurns: Infinity, homeDir: opts.homeDir ?? os.homedir() });
  let server: Server;
  let port: number;
  try {
    await host.open();
    server = createServer(createAgentWorkerHandler({ token: opts.token, host }));
    port = await listen(server, opts.flags.port);
  } catch (err) {
    await host.close();
    throw err;
  }
  return {
    url: `http://${BIND}:${port}`,
    host,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await host.close();
    },
  };
}

export async function runAgentWorker(flags: CliFlags): Promise<void> {
  const token = process.env.TAH_WORKER_TOKEN;
  if (!token) {
    console.error("tah agent-worker: TAH_WORKER_TOKEN is required");
    process.exitCode = 1;
    return;
  }
  const started = await startAgentWorker({ token, flags });
  process.stdout.write(`[tah-worker] ready ${started.url}\n`);
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  process.once("SIGINT", () => process.exit(130));
  await started.stop();
}
