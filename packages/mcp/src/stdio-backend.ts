import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { backendFromClient } from "./client-backend.js";
import type { McpBackend } from "./types.js";

export type StdioMcpOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

/** MCP over stdio via the official client; the child starts on first use. */
export function stdioMcpBackend(options: StdioMcpOptions): McpBackend {
  let client: Client | undefined;
  let started: Promise<Client> | undefined;

  function ensure(): Promise<Client> {
    started ??= (async () => {
      const c = new Client({ name: "typescript-agent-harness", version: "1.2.0" });
      client = c;
      await c.connect(
        new StdioClientTransport({
          command: options.command,
          args: options.args ?? [],
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env
            ? {
                env: Object.fromEntries(
                  Object.entries(options.env).filter(
                    (e): e is [string, string] => e[1] !== undefined,
                  ),
                ),
              }
            : {}),
          stderr: "pipe",
        }),
      );
      return c;
    })();
    return started;
  }

  return backendFromClient({
    listTools: async () => (await ensure()).listTools(),
    callTool: async (args) => (await ensure()).callTool(args),
    listResources: async () => (await ensure()).listResources(),
    readResource: async (args) => (await ensure()).readResource(args),
    listPrompts: async () => (await ensure()).listPrompts(),
    getPrompt: async (args) => (await ensure()).getPrompt(args),
    close: async () => {
      const c = client;
      client = undefined;
      started = undefined;
      await c?.close();
    },
  });
}
