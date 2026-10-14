import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "@typescript-agent-harness/core";
import { mcpResultText, stdioMcpBackend, type McpBackend, type McpToolInfo } from "@typescript-agent-harness/mcp";
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
  /** `tah chat` shows a Chrome window; `tah run` has nobody watching and `tah serve` shows the page in its browser panel. */
  headless: boolean;
  /** Tests swap in a fake MCP server. */
  server?: BrowserServer;
};

/** One tah host's browser: the agent's tools, plus what `tah serve`'s browser panel needs. */
export type Browser = {
  plugin: Plugin;
  /** The agent's `browser_open` was approved and the browser tools are mounted. */
  agentAttached(): boolean;
  /** Playwright MCP is running. */
  running(): boolean;
  /** Starts the browser for the panel; mounts no tools. */
  launch(): Promise<void>;
  /** Chrome's debugging port; undefined while the browser is not running. */
  cdpPort(): number | undefined;
  /** Closes the browser and withdraws the tools. */
  close(): Promise<void>;
};

const profileDir = (homeDir: string) => path.join(homeDir, ".tah", "browser-profile");
const configFile = (homeDir: string) => path.join(homeDir, ".tah", "browser-config.json");

/** Playwright MCP's config: Chrome opens a random debugging port and writes it to `<profile>/DevToolsActivePort`. */
export function writeBrowserConfig(homeDir: string): void {
  mkdirSync(path.dirname(configFile(homeDir)), { recursive: true });
  writeFileSync(configFile(homeDir), `${JSON.stringify({ browser: { launchOptions: { args: ["--remote-debugging-port=0"] } } })}\n`);
}

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
      profileDir(o.homeDir),
      "--output-dir",
      path.join(o.cwd, ".tah", "browser"),
      "--image-responses",
      "omit",
      "--config",
      configFile(o.homeDir),
      "--idle-timeout",
      "0",
      "--viewport-size",
      "1280x720",
      ...(o.headless ? ["--headless"] : []),
    ],
  };
}

export function clipResult(out: unknown): unknown {
  if (typeof out !== "string" || out.length <= BROWSER_RESULT_CHARS) return out;
  return `${out.slice(0, BROWSER_RESULT_CHARS)}\n[truncated: ${out.length - BROWSER_RESULT_CHARS} more chars — use browser_find to search the page]`;
}

/** `browser_open` starts Playwright MCP on first use and mounts the browser tools; `browser_close` takes them down again. The panel can start the browser first (`launch`) without mounting them. */
export function createBrowser(o: BrowserOptions): Browser {
  let tools: ToolService | undefined;
  let backend: McpBackend | undefined;
  let starting: Promise<McpBackend> | undefined;
  let infos: McpToolInfo[] = [];
  let mounted: string[] = [];
  let disposed = false;

  async function shut() {
    for (const name of mounted) tools?.unregister(name);
    mounted = [];
    const b = backend;
    backend = undefined;
    await b?.close?.();
  }

  /** Playwright MCP starts Chrome on its first tool call; `browser_tabs` makes that happen now. */
  async function start(): Promise<McpBackend> {
    if (!o.server) writeBrowserConfig(o.homeDir);
    const b = stdioMcpBackend({ ...(o.server ?? playwrightServer(o)), cwd: o.cwd });
    try {
      infos = (await b.listTools()).filter((t) => BROWSER_TOOLS.includes(t.name));
      mcpResultText(await b.callTool("browser_tabs", { action: "list" }));
    } catch (err) {
      await b.close?.();
      const message = err instanceof Error ? err.message : String(err);
      if (/already in use/i.test(message)) {
        throw new Error(
          `the browser profile ${profileDir(o.homeDir)} is in use by another tah — close that tah (or its browser) and try again`,
        );
      }
      throw new Error(`could not start the browser: ${message}`);
    }
    backend = b;
    return b;
  }

  const ensure = (): Promise<McpBackend> =>
    disposed
      ? Promise.reject(new Error("the browser was shut down"))
      : backend
        ? Promise.resolve(backend)
        : (starting ??= start().finally(() => (starting = undefined)));

  function mount(b: McpBackend) {
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
  }

  const openTool: Tool = {
    name: "browser_open",
    description:
      "Open a Chrome browser the user can watch (or reuse the open one) and go to `url` if given. Afterwards the browser_* tools (navigate, snapshot, click, type, fill_form, …) are available. Use it for clicking, forms, logins, or pages rendered by JavaScript; use web_fetch to just read a page.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Page to open; omit to stay on the current page" } },
      additionalProperties: false,
    },
    async execute(input) {
      const wasRunning = backend !== undefined;
      const b = await ensure();
      if (mounted.length === 0) mount(b);
      const url = (input as { url?: unknown } | undefined)?.url;
      const page = typeof url === "string" && url ? mcpResultText(await b.callTool("browser_navigate", { url })) : "";
      return { opened: !wasRunning, tools: [...mounted], page: clipResult(page) };
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
        disposed = true;
        await starting?.catch(() => {});
        await shut();
      },
    },
    agentAttached: () => mounted.length > 0,
    running: () => backend !== undefined,
    async launch() {
      await ensure();
    },
    cdpPort() {
      if (!backend) return undefined;
      try {
        const port = Number(readFileSync(path.join(profileDir(o.homeDir), "DevToolsActivePort"), "utf8").split("\n")[0]);
        return Number.isInteger(port) && port > 0 ? port : undefined;
      } catch {
        return undefined;
      }
    },
    async close() {
      await starting?.catch(() => {});
      await shut();
    },
  };
}
