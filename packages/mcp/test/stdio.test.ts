import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stdioMcpBackend } from "@typescript-agent-harness/mcp";

const fixture = fileURLToPath(
  new URL("./fixtures/ping-server.mjs", import.meta.url),
);

test("stdio MCP backend lists and calls tools on a child process", async () => {
  const backend = stdioMcpBackend({
    command: process.execPath,
    args: [fixture],
  });
  try {
    const tools = await backend.listTools();
    assert.equal(tools[0]?.name, "ping");
    const out = await backend.callTool("ping", { text: "hi" });
    const text =
      out &&
      typeof out === "object" &&
      "content" in out &&
      Array.isArray((out as { content: unknown }).content)
        ? ((out as { content: Array<{ text?: string }> }).content[0]?.text ?? "")
        : "";
    assert.match(text, /hi/);
  } finally {
    await backend.close?.();
  }
});
