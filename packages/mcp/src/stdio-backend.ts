import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpBackend, McpToolInfo } from "./types.js";

export type StdioMcpOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
};

type JsonRpc = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

/** MCP stdio transport: one JSON-RPC message per line in each direction. */
export function stdioMcpBackend(options: StdioMcpOptions): McpBackend {
  let child: ChildProcessWithoutNullStreams | undefined;
  let nextId = 1;
  let stdoutBuf = "";
  let stderrTail = "";
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  let started: Promise<void> | undefined;

  function write(msg: JsonRpc) {
    if (!child) throw new Error("MCP stdio process is not running");
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  function failAll(err: Error) {
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
  }

  function onMessage(msg: JsonRpc) {
    if (msg.method !== undefined || msg.id === undefined) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  }

  function ingest(chunk: string) {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue;
      }
      onMessage(msg);
    }
  }

  function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const msg: JsonRpc = { jsonrpc: "2.0", id, method };
      if (params !== undefined) msg.params = params;
      try {
        write(msg);
      } catch (err) {
        pending.delete(id);
        reject(err as Error);
      }
    });
  }

  async function start() {
    const spawnOpts: {
      stdio: ["pipe", "pipe", "pipe"];
      cwd?: string;
      env?: Record<string, string | undefined>;
    } = { stdio: ["pipe", "pipe", "pipe"] };
    if (options.cwd) spawnOpts.cwd = options.cwd;
    if (options.env) spawnOpts.env = { ...process.env, ...options.env };

    child = spawn(options.command, options.args ?? [], spawnOpts);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => ingest(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (err) => failAll(err));
    child.on("exit", (code) => {
      const tail = stderrTail.trim();
      failAll(new Error(`MCP stdio process exited (${code ?? "null"})${tail ? `: ${tail}` : ""}`));
    });

    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "typescript-agent-harness", version: "0.8.0" },
    });
    write({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  function ensure() {
    started ??= start();
    return started;
  }

  return {
    async listTools() {
      await ensure();
      const result = (await request("tools/list")) as { tools?: McpToolInfo[] };
      return result.tools ?? [];
    },
    async callTool(name, args) {
      await ensure();
      return request("tools/call", { name, arguments: args ?? {} });
    },
    async close() {
      if (!child) return;
      failAll(new Error("MCP stdio backend closed"));
      child.stdin.end();
      child.kill();
      child = undefined;
      started = undefined;
    },
  };
}
