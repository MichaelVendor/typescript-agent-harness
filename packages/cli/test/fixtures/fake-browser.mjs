#!/usr/bin/env node
/** Stands in for Playwright MCP in tests: one JSON-RPC message per line. */
const tool = (name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
const TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_close",
  "browser_run_code_unsafe",
].map(tool);
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const text = (id, t, extra = []) => reply(id, { content: [{ type: "text", text: t }, ...extra] });

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const msg = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    if (msg.method === "initialize") {
      reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-browser", version: "0" } });
    } else if (msg.method === "tools/list") {
      reply(msg.id, { tools: TOOLS });
    } else if (msg.method === "tools/call") {
      const { name, arguments: args } = msg.params;
      if (name === "browser_navigate" && args.url === "busy://profile") {
        reply(msg.id, { content: [{ type: "text", text: "### Error\nError: Browser is already in use for /p, use --isolated to run multiple instances of the same browser" }], isError: true });
      } else if (name === "browser_navigate") text(msg.id, `- Page URL: ${args.url}\n- Page Title: Title of ${args.url}`);
      else if (name === "browser_snapshot") text(msg.id, "x".repeat(40_000));
      else if (name === "browser_take_screenshot") {
        text(msg.id, "saved .tah/browser/page.png", [{ type: "image", data: "AAAA", mimeType: "image/png" }]);
      } else text(msg.id, "closed");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
