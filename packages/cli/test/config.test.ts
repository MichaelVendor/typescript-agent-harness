import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import {
  loadTahConfig,
  parseTahConfig,
  resolveCapabilities,
} from "../dist/config.js";
import { bootRuntime, mcpServerLabel, rejectContextNameClash } from "../dist/runtime.js";
import { addModel, setModelVision, setSearchKey } from "../dist/settings.js";

const homeDir = mkdtempSync(path.join(tmpdir(), "tah-home-"));
const MARKER = JSON.stringify({
  type: "module",
  devDependencies: { "@typescript-agent-harness/cli": "*" },
});

const PLAIN_TOOL = `export default {
  description: "echo",
  inputSchema: { type: "object", properties: {} },
  async execute() { return {}; },
};
`;

function projectDir(files: Record<string, string>): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-config-"));
  for (const [rel, content] of Object.entries({ "package.json": MARKER, ...files })) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return cwd;
}

function flagBits(
  extra: Partial<{
    exec: boolean;
    execSet: boolean;
    builtinTools: boolean;
    vision: boolean;
    visionSet: boolean;
    mcpCommand: string;
    mcpArgs: string[];
    allow: string[];
    deny: string[];
  }> = {},
) {
  return {
    exec: true,
    execSet: false,
    builtinTools: false,
    vision: false,
    visionSet: false,
    mcpCommand: "",
    mcpArgs: [] as string[],
    allow: [] as string[],
    deny: [] as string[],
    ...extra,
  };
}

test("parseTahConfig accepts capabilities and mcp", () => {
  const cfg = parseTahConfig({
    capabilities: { coding: { exec: false }, vision: true },
    extensions: { mcp: { command: "node", args: ["s.mjs"] } },
  });
  assert.deepEqual(cfg.capabilities?.coding, { exec: false });
  assert.equal(cfg.capabilities?.vision, true);
  assert.deepEqual(cfg.extensions?.mcp, [
    { transport: "stdio", command: "node", args: ["s.mjs"] },
  ]);
});

test("mcp url and headers parse; command and url together fail", () => {
  const parsed = parseTahConfig({
    extensions: { mcp: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } } },
  });
  assert.deepEqual(parsed.extensions?.mcp, [
    { transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
  ]);
  assert.throws(
    () => parseTahConfig({ extensions: { mcp: { command: "npx", url: "https://example.com/mcp" } } }),
    /must set command or url, not both/,
  );
  assert.throws(
    () => parseTahConfig({ extensions: { mcp: { headers: { A: "b" } } } }),
    /must set command or url/,
  );
  assert.throws(
    () => parseTahConfig({ extensions: { mcp: { url: "https://example.com/mcp", headers: { A: 1 } } } }),
    /headers/,
  );
});

test("parseTahConfig accepts several mcp servers and permissions", () => {
  const cfg = parseTahConfig({
    extensions: {
      mcp: [
        { command: "node", args: ["a.mjs"] },
        { command: "npx", args: ["-y", "other"] },
      ],
    },
    permissions: { deny: ["execute_command"], allow: ["list_files"] },
  });
  assert.equal(cfg.extensions?.mcp?.length, 2);
  assert.deepEqual(cfg.permissions, { deny: ["execute_command"], allow: ["list_files"] });
  assert.throws(() => parseTahConfig({ extensions: { mcp: [] } }), /at least one server/);
  assert.throws(() => parseTahConfig({ permissions: { deny: [""] } }), /non-empty strings/);
  assert.throws(() => parseTahConfig({ permissions: { block: ["x"] } }), /unknown permissions option/);
});

test("parseTahConfig rejects unknown keys", () => {
  assert.throws(() => parseTahConfig({ foo: 1 }), /unknown key "foo"/);
  assert.throws(() => parseTahConfig({ capabilities: { lsp: true } }), /unknown capability "lsp"/);
  assert.throws(() => parseTahConfig({ extensions: { http: {} } }), /unknown extension "http"/);
});

test("loadTahConfig ignores non-projects and missing files", () => {
  const plain = mkdtempSync(path.join(tmpdir(), "tah-noconfig-"));
  writeFileSync(path.join(plain, "tah.config.json"), '{"capabilities":{"vision":true}}');
  assert.equal(loadTahConfig(plain), undefined);

  const proj = projectDir({});
  assert.equal(loadTahConfig(proj), undefined);
});

test("resolveCapabilities: tools/ off by default; config coding true; --builtin-tools wins", () => {
  const project = { tools: [], plugins: [], hasToolsDir: true };
  const base = resolveCapabilities(undefined, flagBits(), project);
  assert.equal(base.coding, false);

  const fromConfig = resolveCapabilities({ capabilities: { coding: true } }, flagBits(), project);
  assert.equal(fromConfig.coding, true);
  assert.equal(fromConfig.exec, true);

  const flag = resolveCapabilities(
    { capabilities: { coding: false } },
    flagBits({ builtinTools: true }),
    project,
  );
  assert.equal(flag.coding, true);
});

test("resolveCapabilities: config exec false; --exec overrides", () => {
  const caps = resolveCapabilities(
    { capabilities: { coding: { exec: false } } },
    flagBits(),
    undefined,
  );
  assert.equal(caps.coding, true);
  assert.equal(caps.exec, false);

  const overridden = resolveCapabilities(
    { capabilities: { coding: { exec: false } } },
    flagBits({ exec: true, execSet: true }),
    undefined,
  );
  assert.equal(overridden.exec, true);
});

test("resolveCapabilities: vision from config; CLI/env visionSet wins", () => {
  assert.equal(
    resolveCapabilities({ capabilities: { vision: true } }, flagBits(), undefined).vision,
    true,
  );
  assert.equal(
    resolveCapabilities(
      { capabilities: { vision: true } },
      flagBits({ vision: false, visionSet: true }),
      undefined,
    ).vision,
    false,
  );
});

test("resolveCapabilities: web follows coding unless the config sets it", () => {
  const project = { tools: [], plugins: [], hasToolsDir: true };
  assert.equal(resolveCapabilities(undefined, flagBits(), undefined).web, true);
  assert.equal(resolveCapabilities(undefined, flagBits(), project).web, false);
  assert.equal(resolveCapabilities({ capabilities: { web: true } }, flagBits(), project).web, true);
  assert.equal(resolveCapabilities({ capabilities: { web: false } }, flagBits(), undefined).web, false);
});

test("bootRuntime loads tah.config.json coding with tools/", async () => {
  const cwd = projectDir({
    "tools/echo.ts": PLAIN_TOOL,
    "tah.config.json": JSON.stringify({ capabilities: { coding: true, vision: true } }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const { runtime, caps, startup } = await bootRuntime(flags, { homeDir });
  assert.equal(caps.coding, true);
  assert.equal(caps.vision, true);
  assert.equal(flags.vision, true);
  assert.match(startup, /config=on/);
  assert.match(startup, /vision=on/);
  const names = runtime.get(TOOLS).list().map((t) => t.name).sort();
  const ocr = process.platform === "darwin" ? ["read_image_text"] : [];
  assert.deepEqual(names, ["echo", "edit_file", "execute_command", "grep", "list_files", "read_file", ...ocr, "todo_write", "web_fetch", "web_search", "write_file"]);
  await runtime.stop();
});

test("bootRuntime: the active saved model's flag decides vision, not --vision", async () => {
  const cwd = projectDir({});
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  const flags = () => ({ ...parseArgv(["--no-persist", "--quiet", "--vision", "run", "hi"]), cwd });
  const plain = addModel(home, { model: "deepseek-chat", apiKey: "sk-a" });
  const off = await bootRuntime(flags(), { homeDir: home });
  assert.equal(off.vision, false);
  assert.doesNotMatch(off.startup, /vision=on/);
  await off.runtime.stop();

  setModelVision(home, plain.id, true);
  const on = await bootRuntime(flags(), { homeDir: home });
  assert.equal(on.vision, true);
  assert.match(on.startup, /vision=on/);
  assert.equal(on.ocr, process.platform === "darwin");
  await on.runtime.stop();
});

test("bootRuntime mounts web_fetch and web_search for capabilities.web, with or without a Tavily key", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({ capabilities: { web: true } }),
  });
  const mock = await bootRuntime({ ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd }, { homeDir });
  const mockNames = mock.runtime.get(TOOLS).list().map((t) => t.name);
  assert.match(mock.startup, /web=on/);
  assert.ok(mockNames.includes("web_fetch") && mockNames.includes("web_search"));
  await mock.runtime.stop();

  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  setSearchKey(home, "tvly-test");
  const prev = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-test";
  try {
    const live = await bootRuntime({ ...parseArgv(["--no-persist", "--quiet", "run", "hi"]), cwd }, { homeDir: home });
    assert.match(live.startup, /web=on/);
    assert.ok(live.runtime.get(TOOLS).list().some((t) => t.name === "web_search"));
    await live.runtime.stop();
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
});

test("bootRuntime: capabilities.web false drops the web tools", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({ capabilities: { coding: true, web: false } }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const { runtime, startup } = await bootRuntime(flags, { homeDir });
  assert.doesNotMatch(startup, /web=/);
  assert.ok(!runtime.get(TOOLS).list().some((t) => t.name.startsWith("web_")));
  await runtime.stop();
});

test("bootRuntime --no-exec overrides config coding.exec", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({ capabilities: { coding: { exec: true } } }),
  });
  const flags = {
    ...parseArgv(["--mock", "--no-persist", "--quiet", "--no-exec", "run", "hi"]),
    cwd,
  };
  const { runtime, caps } = await bootRuntime(flags, { homeDir });
  assert.equal(caps.exec, false);
  assert.equal(
    runtime.get(TOOLS).list().some((t) => t.name === "execute_command"),
    false,
  );
  await runtime.stop();
});

test("bootRuntime mounts mcp from extensions.mcp", async () => {
  const pingServer = fileURLToPath(
    new URL("../../mcp/test/fixtures/ping-server.mjs", import.meta.url),
  );
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({
      extensions: { mcp: { command: process.execPath, args: [pingServer] } },
    }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const { runtime, startup } = await bootRuntime(flags, { homeDir });
  assert.match(startup, /mcp=1/);
  assert.equal(runtime.get(TOOLS).listSchemas().some((t) => t.name === "ping"), true);
  await runtime.stop();
});

test("bootRuntime mounts every extensions.mcp server; a repeated tool name fails", async () => {
  const pingServer = fileURLToPath(
    new URL("../../mcp/test/fixtures/ping-server.mjs", import.meta.url),
  );
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({
      extensions: {
        mcp: [
          { command: process.execPath, args: [pingServer] },
          { command: process.execPath, args: [pingServer, "pong"] },
        ],
      },
    }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const { runtime, startup } = await bootRuntime(flags, { homeDir });
  const names = runtime.get(TOOLS).listSchemas().map((t) => t.name);
  assert.match(startup, /mcp=2/);
  assert.equal(names.includes("ping") && names.includes("pong"), true);
  await runtime.stop();

  const clash = projectDir({
    "tah.config.json": JSON.stringify({
      extensions: {
        mcp: [
          { command: process.execPath, args: [pingServer] },
          { command: process.execPath, args: [pingServer] },
        ],
      },
    }),
  });
  await assert.rejects(
    () => bootRuntime({ ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd: clash }, { homeDir }),
    /duplicate MCP server label:/,
  );
});

test("a remote tool named list_resources clashes with the fixed tool", () => {
  assert.throws(
    () => rejectContextNameClash(["list_resources"], ["list_resources", "read_resource"]),
    /Duplicate tool name: list_resources/,
  );
});

test("identical stdio mcp commands share a label", () => {
  assert.equal(mcpServerLabel({ transport: "stdio", command: "npx", args: ["-y", "pkg"] }), "npx -y pkg");
  assert.equal(mcpServerLabel({ transport: "http", url: "https://example.com/mcp", headers: {} }), "https://example.com/mcp");
});

test("permissions in tah.config.json hide tools; --deny replaces the config list", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({
      permissions: { deny: ["write_file"], allow: ["list_files", "read_file"] },
    }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const fromConfig = await bootRuntime(flags, { homeDir });
  assert.match(fromConfig.startup, /perms=on/);
  assert.deepEqual(
    fromConfig.runtime.get(TOOLS).listSchemas().map((t) => t.name).sort(),
    ["list_files", "read_file"],
  );
  await fromConfig.runtime.stop();

  const replaced = resolveCapabilities(
    { permissions: { deny: ["write_file"], allow: ["list_files"] } },
    flagBits({ deny: ["execute_command"] }),
    undefined,
  );
  assert.deepEqual(replaced.deny, ["execute_command"]);
  assert.deepEqual(replaced.allow, ["list_files"]);

  const mcpReplaced = resolveCapabilities(
    { extensions: { mcp: [{ command: "node", args: ["a.mjs"] }, { command: "npx", args: [] }] } },
    flagBits({ mcpCommand: "node", mcpArgs: ["b.mjs"] }),
    undefined,
  );
  assert.deepEqual(mcpReplaced.mcp, [{ transport: "stdio", command: "node", args: ["b.mjs"] }]);
});

test("resolveCapabilities: browser follows web unless the config sets it", () => {
  assert.equal(resolveCapabilities(undefined, flagBits(), undefined).browser, true);
  assert.equal(resolveCapabilities({ capabilities: { web: false } }, flagBits(), undefined).browser, false);
  assert.equal(resolveCapabilities({ capabilities: { browser: false } }, flagBits(), undefined).browser, false);
  assert.equal(resolveCapabilities({ capabilities: { web: false, browser: true } }, flagBits(), undefined).browser, true);
  assert.throws(() => parseTahConfig({ capabilities: { browser: "yes" } }), /capabilities.browser must be a boolean/);
});
