import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mcpResultText, stdioMcpBackend, toolsFromMcp } from "@typescript-agent-harness/mcp";

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

test("toolsFromMcp turns MCP results into text; isError throws; images are left out", async () => {
  const backend = stdioMcpBackend({ command: process.execPath, args: [fixture] });
  try {
    const tools = toolsFromMcp(backend, await backend.listTools());
    const by = (n: string) => tools.find((t) => t.name === n)!;
    const ctx = {} as Parameters<(typeof tools)[number]["execute"]>[1];
    assert.equal(await by("ping").execute({ text: "hi" }, ctx), "pong:hi");
    assert.equal(await by("shot").execute({}, ctx), "saved\n[image omitted]");
    await assert.rejects(by("fail").execute({}, ctx), /boom/);
  } finally {
    await backend.close?.();
  }
});

test("mcpResultText leaves non-MCP results alone", () => {
  assert.deepEqual(mcpResultText({ pong: "x" }), { pong: "x" });
});

test("a command that cannot start rejects instead of crashing", async () => {
  const backend = stdioMcpBackend({ command: "/nonexistent/tah-mcp" });
  await assert.rejects(backend.listTools(), /ENOENT|exited/);
  await backend.close?.();
});
