import assert from "node:assert/strict";
import { test } from "node:test";
import { httpMcpBackend } from "@typescript-agent-harness/mcp";

test("HTTP tries streamable, then SSE, and hides headers", async () => {
  const seen: string[] = [];
  const backend = httpMcpBackend({
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer secret-token" },
    async connectKind(kind) {
      seen.push(kind);
      if (kind === "streamable") throw new Error("stream down");
      return {
        async listTools() {
          return { tools: [] };
        },
        async callTool() {
          return { content: [] };
        },
        async listResources() {
          return { resources: [] };
        },
        async readResource() {
          return { contents: [] };
        },
        async listPrompts() {
          return { prompts: [] };
        },
        async getPrompt() {
          return { messages: [] };
        },
        async close() {},
      };
    },
  });
  assert.deepEqual(await backend.listTools(), []);
  assert.deepEqual(seen, ["streamable", "sse"]);
});

test("both HTTP transports fail with both reasons and no header value", async () => {
  const backend = httpMcpBackend({
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer secret-token" },
    async connectKind(kind) {
      throw new Error(kind === "streamable" ? "stream down" : "sse down");
    },
  });
  await assert.rejects(backend.listTools(), (err: Error) => {
    assert.match(err.message, /MCP server failed \(https:\/\/example.com\/mcp\)/);
    assert.match(err.message, /Streamable HTTP: stream down/);
    assert.match(err.message, /SSE: sse down/);
    assert.doesNotMatch(err.message, /secret-token/);
    return true;
  });
});
