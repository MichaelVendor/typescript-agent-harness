#!/usr/bin/env node
/**
 * Minimal MCP stdio server for tests: one JSON-RPC message per line, as the MCP spec says.
 * Each message is written in two chunks so clients must join partial lines.
 */

let buffer = "";

function write(msg) {
  const line = `${JSON.stringify(msg)}\n`;
  const half = Math.floor(line.length / 2);
  process.stdout.write(line.slice(0, half));
  setImmediate(() => process.stdout.write(line.slice(half)));
}

const only = process.argv[2];
const ALL_TOOLS = [
  { name: "ping", description: "echo ping", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "fail", description: "always fails", inputSchema: { type: "object", properties: {} } },
  { name: "shot", description: "text and an image", inputSchema: { type: "object", properties: {} } },
];
/** `node ping-server.mjs <name>` exposes only that tool, so two test servers can run side by side. */
const TOOLS = only
  ? [{ name: only, description: only, inputSchema: { type: "object", properties: {} } }]
  : ALL_TOOLS;

function handle(msg) {
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ah-test-ping", version: "0.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    write({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method !== "tools/call") return;
  const name = msg.params?.name;
  if (only && name === only) {
    write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: only }] } });
    return;
  }
  if (name === "ping") {
    const text = msg.params?.arguments?.text ?? "";
    write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `pong:${text}` }] } });
    return;
  }
  if (name === "fail") {
    write({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "boom" }], isError: true } });
    return;
  }
  if (name === "shot") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [
          { type: "text", text: "saved" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
        ],
      },
    });
    return;
  }
  write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown tool: ${name}` } });
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line));
  }
});

process.stdin.on("end", () => process.exit(0));
