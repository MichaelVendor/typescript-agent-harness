import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "@typescript-agent-harness/core";
import { mcpResultText, stdioMcpBackend, type McpBackend } from "@typescript-agent-harness/mcp";
import { TOOLS, type Tool, type ToolService } from "@typescript-agent-harness/tools";

/** Playwright MCP tools the model gets; code-running, network-inspection and rarely useful ones stay off. */
export const BROWSER_TOOLS = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_find",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_press_key",
  "browser_hover",
  "browser_drag",
  "browser_wait_for",
  "browser_tabs",
  "browser_take_screenshot",
  "browser_handle_dialog",
  "browser_file_upload",
  "browser_console_messages",
  "browser_close",
];

export const BROWSER_RESULT_CHARS = 30_000;

export type BrowserServer = { command: string; args: string[] };

export type BrowserOptions = {
  cwd: string;
  homeDir: string;
  /** `tah run` has nobody watching; chat and serve show the window. */
  headless: boolean;
  /** Tests swap in a fake MCP server. */
  server?: BrowserServer;
};

export function playwrightServer(o: BrowserOptions): BrowserServer {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("@playwright/mcp/package.json");
  const bin = (JSON.parse(readFileSync(pkg, "utf8")) as { bin: Record<string, string> }).bin["playwright-mcp"]!;
  return {
    command: process.execPath,
    args: [
      path.join(path.dirname(pkg), bin),
      "--browser",
      "chrome",
      "--user-data-dir",
      path.join(o.homeDir, ".tah", "browser-profile"),
      "--output-dir",
      path.join(o.cwd, ".tah", "browser"),
      "--image-responses",
      "omit",
      ...(o.headless ? ["--headless"] : []),
    ],
  };
}

export function clipResult(out: unknown): unknown {
  if (typeof out !== "string" || out.length <= BROWSER_RESULT_CHARS) return out;
  return `${out.slice(0, BROWSER_RESULT_CHARS)}\n[truncated: ${out.length - BROWSER_RESULT_CHARS} more chars — use browser_find to search the page]`;
}

/** `browser_open` starts Playwright MCP on first use and mounts the browser tools; `browser_close` takes them down again. */
export function createBrowser(o: BrowserOptions): { plugin: Plugin; isOpen(): boolean } {
  let tools: ToolService | undefined;
  let backend: McpBackend | undefined;
  let opening: Promise<McpBackend> | undefined;
  let mounted: string[] = [];

  async function shut() {
    for (const name of mounted) tools?.unregister(name);
    mounted = [];
    const b = backend;
    backend = undefined;
    await b?.close?.();
  }

  async function start(): Promise<McpBackend> {
    const b = stdioMcpBackend({ ...(o.server ?? playwrightServer(o)), cwd: o.cwd });
    try {
      const infos = (await b.listTools()).filter((t) => BROWSER_TOOLS.includes(t.name));
      for (const info of infos) {
        tools!.register({
          name: info.name,
          description: info.description,
          inputSchema: info.inputSchema,
          async execute(input) {
            const out = clipResult(mcpResultText(await b.callTool(info.name, input)));
            if (info.name === "browser_close") await shut();
            return out;
          },
        });
        mounted.push(info.name);
      }
      backend = b;
      return b;
    } catch (err) {
      for (const name of mounted) tools!.unregister(name);
      mounted = [];
      await b.close?.();
      throw new Error(`could not start the browser: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const openTool: Tool = {
    name: "browser_open",
    description:
      "Open a Chrome window the user can see (or reuse the open one) and go to `url` (a blank page if omitted). Afterwards the browser_* tools (navigate, snapshot, click, type, fill_form, …) are available. Use it for clicking, forms, logins, or pages rendered by JavaScript; use web_fetch to just read a page.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Page to open; omit for a blank page" } },
      additionalProperties: false,
    },
    async execute(input) {
      const wasOpen = backend !== undefined;
      const b = backend ?? (await (opening ??= start().finally(() => (opening = undefined))));
      const url = (input as { url?: unknown } | undefined)?.url;
      const target = typeof url === "string" && url ? url : wasOpen ? undefined : "about:blank";
      const page = target ? mcpResultText(await b.callTool("browser_navigate", { url: target })) : "";
      return { opened: !wasOpen, tools: [...mounted], page: clipResult(page) };
    },
  };

  return {
    plugin: {
      name: "browser",
      setup(ctx) {
        tools = ctx.get(TOOLS);
        tools.register(openTool);
      },
      async dispose() {
        await shut();
      },
    },
    isOpen: () => backend !== undefined,
  };
}
