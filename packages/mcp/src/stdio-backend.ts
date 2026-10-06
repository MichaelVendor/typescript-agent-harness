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

export function stdioMcpBackend(options: StdioMcpOptions): McpBackend {
  let child: ChildProcessWithoutNullStreams | undefined;
  let nextId = 1;
  let stdoutBuf = Buffer.alloc(0);
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  let started: Promise<void> | undefined;

  function write(msg: JsonRpc) {
    if (!child) throw new Error("MCP stdio process is not running");
    const json = JSON.stringify(msg);
    const body = Buffer.from(json, "utf8");
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  }

  function onMessage(msg: JsonRpc) {
    if (msg.id === undefined) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(msg.error.message));
      return;
    }
    waiter.resolve(msg.result);
  }

  function ingest(chunk: Buffer) {
    stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
    while (true) {
      const headerEnd = stdoutBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = stdoutBuf.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        stdoutBuf = stdoutBuf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (stdoutBuf.length < start + len) break;
      const body = stdoutBuf.subarray(start, start + len).toString("utf8");
      stdoutBuf = stdoutBuf.subarray(start + len);
      onMessage(JSON.parse(body) as JsonRpc);
    }
  }

  function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const msg: JsonRpc = { jsonrpc: "2.0", id, method };
      if (params !== undefined) msg.params = params;
      write(msg);
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
    child.stdout.on("data", (chunk: Buffer) => ingest(chunk));
    child.on("exit", (code) => {
      const err = new Error(`MCP stdio process exited (${code ?? "null"})`);
      for (const waiter of pending.values()) waiter.reject(err);
      pending.clear();
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
      for (const waiter of pending.values()) {
        waiter.reject(new Error("MCP stdio backend closed"));
      }
      pending.clear();
      child.stdin.end();
      child.kill();
      child = undefined;
      started = undefined;
    },
  };
}
