#!/usr/bin/env node
/** Stands in for Playwright MCP in tests: one JSON-RPC message per line. `--user-data-dir <dir>` gets a DevToolsActivePort once the browser "starts"; `--busy` acts as if another tah holds the profile. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const tool = (name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
const TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_tabs",
  "browser_close",
  "browser_run_code_unsafe",
].map(tool);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const profile = arg("--user-data-dir");
const busy = process.argv.includes("--busy");
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
      if (name === "browser_tabs" && busy) {
        reply(msg.id, { content: [{ type: "text", text: "### Error\nError: Browser is already in use for /p, use --isolated to run multiple instances of the same browser" }], isError: true });
      } else if (name === "browser_tabs") {
        if (profile) {
          mkdirSync(profile, { recursive: true });
          writeFileSync(path.join(profile, "DevToolsActivePort"), "9222\n/devtools/browser/fake\n");
        }
        text(msg.id, "### Result\n- 0: (current) [](about:blank)");
      } else if (name === "browser_navigate") text(msg.id, `- Page URL: ${args.url}\n- Page Title: Title of ${args.url}`);
      else if (name === "browser_snapshot") text(msg.id, "x".repeat(40_000));
      else if (name === "browser_take_screenshot") {
        text(msg.id, "saved .tah/browser/page.png", [{ type: "image", data: "AAAA", mimeType: "image/png" }]);
      } else text(msg.id, "closed");
    }
  }
});
process.stdin.on("end", () => process.exit(0));
