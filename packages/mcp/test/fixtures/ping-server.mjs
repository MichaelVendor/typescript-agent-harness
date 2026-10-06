#!/usr/bin/env node
/**
 * Minimal MCP stdio server for tests (JSON-RPC + Content-Length).
 */

let buffer = Buffer.alloc(0);

function write(msg) {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

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
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "ping",
            description: "echo ping",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const text = msg.params?.arguments?.text ?? "";
    if (name !== "ping") {
      write({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `unknown tool: ${name}` },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: `pong:${text}` }],
      },
    });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + len) break;
    const body = buffer.subarray(start, start + len).toString("utf8");
    buffer = buffer.subarray(start + len);
    handle(JSON.parse(body));
  }
});

process.stdin.on("end", () => process.exit(0));
