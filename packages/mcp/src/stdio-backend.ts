import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Readable } from "node:stream";
import { backendFromClient } from "./client-backend.js";
import type { McpBackend } from "./types.js";

const STDERR_TAIL_BYTES = 2048;

/** Consume piped child stderr so the transport cannot block on a full pipe. */
function drainStderr(stderr: Readable | null): void {
  if (!stderr) return;
  let tail = "";
  stderr.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    tail = (tail + text).slice(-STDERR_TAIL_BYTES);
  });
  stderr.resume();
}

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
      const c = new Client({ name: "typescript-agent-harness", version: "1.6.6" });
      client = c;
      const transport = new StdioClientTransport({
        command: options.command,
        args: options.args ?? [],
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...options.env }).filter(
            (e): e is [string, string] => e[1] !== undefined,
          ),
        ),
        stderr: "pipe",
      });
      drainStderr(transport.stderr as Readable | null);
      await c.connect(transport);
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
