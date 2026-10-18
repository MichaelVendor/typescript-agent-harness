import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import type { CliFlags } from "../args.js";
import { createChatHost } from "../host.js";
import { createAgentHostHandler } from "./http.js";

export type AgentHostOptions = {
  secret: string;
  projectId: string;
  host: string;
  port: number;
  flags: CliFlags;
  homeDir?: string;
};

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startAgentHost(opts: AgentHostOptions): Promise<{ url: string; stop(): Promise<void> }> {
  const host = await createChatHost(opts.flags, { historyTurns: Infinity, homeDir: opts.homeDir ?? os.homedir() });
  let server: Server;
  let port: number;
  try {
    await host.open();
    server = createServer(createAgentHostHandler({ secret: opts.secret, projectId: opts.projectId }));
    port = await listen(server, opts.host, opts.port);
  } catch (err) {
    await host.close();
    throw err;
  }
  return {
    url: `http://${opts.host}:${port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await host.close();
    },
  };
}
