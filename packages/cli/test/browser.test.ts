import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Runtime } from "@typescript-agent-harness/core";
import { TOOLS, toolsPlugin } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { BROWSER_RESULT_CHARS, createBrowser, playwrightServer } from "../dist/browser.js";
import { bootRuntime } from "../dist/runtime.js";

const fake = fileURLToPath(new URL("./fixtures/fake-browser.mjs", import.meta.url));
const dir = () => mkdtempSync(path.join(tmpdir(), "tah-browser-"));

async function boot(server = { command: process.execPath, args: [fake] }) {
  const browser = createBrowser({ cwd: dir(), homeDir: dir(), headless: true, server });
  const runtime = new Runtime({ id: "t" });
  runtime.use(toolsPlugin({ tools: [] })).use(browser.plugin);
  await runtime.start();
  const tools = runtime.get(TOOLS);
  let n = 0;
  const call = (name: string, args: unknown = {}) => {
    n += 1;
    const id = `c${n}`;
    return tools.execute(
      { id, name, arguments: args },
      { sessionId: "s", callId: id, signal: new AbortController().signal, runtime: runtime.context() },
    );
  };
  const names = () => tools.listSchemas().map((t) => t.name).sort();
  return { browser, runtime, call, names };
}

test("browser_open mounts the allowed browser tools; a second open reuses the browser", async () => {
  const { browser, runtime, call, names } = await boot();
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.isOpen(), false);
  const first = await call("browser_open", { url: "https://example.com" });
  assert.equal(first.ok, true);
  assert.equal((first.output as { opened: boolean }).opened, true);
  assert.match(String((first.output as { page: string }).page), /Title of https:\/\/example.com/);
  assert.deepEqual(names(), ["browser_close", "browser_navigate", "browser_open", "browser_snapshot", "browser_take_screenshot"]);
  assert.equal(browser.isOpen(), true);
  const again = await call("browser_open");
  assert.equal((again.output as { opened: boolean }).opened, false);
  assert.equal((again.output as { page: string }).page, "");
  await runtime.stop();
  assert.equal(browser.isOpen(), false);
});

test("long results are clipped and images are left out", async () => {
  const { runtime, call } = await boot();
  await call("browser_open");
  const snap = String((await call("browser_snapshot")).output);
  assert.equal(snap.startsWith("x".repeat(BROWSER_RESULT_CHARS)), true);
  assert.match(snap, /\[truncated: 10000 more chars — use browser_find/);
  assert.equal((await call("browser_take_screenshot")).output, "saved .tah/browser/page.png\n[image omitted]");
  await runtime.stop();
});

test("browser_close withdraws the browser tools until the next browser_open", async () => {
  const { browser, runtime, call, names } = await boot();
  await call("browser_open");
  assert.equal((await call("browser_close")).ok, true);
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.isOpen(), false);
  await call("browser_open");
  assert.equal(browser.isOpen(), true);
  await runtime.stop();
});

test("a browser that cannot start fails browser_open and mounts nothing", async () => {
  const { browser, runtime, call, names } = await boot({ command: "/nonexistent/playwright-mcp", args: [] });
  const out = await call("browser_open");
  assert.equal(out.ok, false);
  assert.match(String((out.output as { error: string }).error), /could not start the browser/);
  assert.deepEqual(names(), ["browser_open"]);
  assert.equal(browser.isOpen(), false);
  await runtime.stop();
});

test("playwrightServer runs the bundled Playwright MCP with Chrome, the tah profile, and no images", () => {
  const s = playwrightServer({ cwd: "/w", homeDir: "/h", headless: false });
  assert.equal(s.command, process.execPath);
  assert.match(s.args[0]!, /@playwright[\\/]mcp[\\/]cli\.js$/);
  assert.deepEqual(s.args.slice(1), [
    "--browser",
    "chrome",
    "--user-data-dir",
    path.join("/h", ".tah", "browser-profile"),
    "--output-dir",
    path.join("/w", ".tah", "browser"),
    "--image-responses",
    "omit",
  ]);
  assert.equal(playwrightServer({ cwd: "/w", homeDir: "/h", headless: true }).args.at(-1), "--headless");
});

test("bootRuntime mounts browser_open (not with --mock); approval is asked only while the browser is closed", async () => {
  const cwd = dir();
  const homeDir = dir();
  const mock = await bootRuntime({ ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd }, { homeDir });
  assert.equal(mock.runtime.get(TOOLS).list().some((t) => t.name === "browser_open"), false);
  assert.doesNotMatch(mock.startup, /browser=on/);
  await mock.runtime.stop();

  const prev = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test";
  const asked: string[] = [];
  try {
    const live = await bootRuntime({ ...parseArgv(["--no-persist", "--quiet", "chat"]), cwd }, {
      homeDir,
      browserServer: { command: process.execPath, args: [fake] },
      ask: async (c) => {
        asked.push(c.name);
        return "yes";
      },
    });
    assert.match(live.startup, /browser=on/);
    const tools = live.runtime.get(TOOLS);
    const ctx = (id: string) => ({ sessionId: "s", callId: id, signal: new AbortController().signal, runtime: live.runtime.context() });
    await tools.execute({ id: "a", name: "browser_open", arguments: {} }, ctx("a"));
    await tools.execute({ id: "b", name: "browser_open", arguments: {} }, ctx("b"));
    assert.deepEqual(asked, ["browser_open"]);
    await live.runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
});
