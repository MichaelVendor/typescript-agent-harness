import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import {
  assertWebImplemented,
  loadTahConfig,
  parseTahConfig,
  resolveCapabilities,
} from "../dist/config.js";
import { ProjectError } from "../dist/project.js";
import { bootRuntime } from "../dist/runtime.js";

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
  assert.deepEqual(cfg.extensions?.mcp, { command: "node", args: ["s.mjs"] });
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

test("assertWebImplemented rejects web true", () => {
  const caps = resolveCapabilities({ capabilities: { web: true } }, flagBits(), undefined);
  assert.throws(() => assertWebImplemented(caps), /web is not implemented/);
});

test("bootRuntime loads tah.config.json coding with tools/", async () => {
  const cwd = projectDir({
    "tools/echo.ts": PLAIN_TOOL,
    "tah.config.json": JSON.stringify({ capabilities: { coding: true, vision: true } }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  const { runtime, caps, startup } = await bootRuntime(flags);
  assert.equal(caps.coding, true);
  assert.equal(caps.vision, true);
  assert.equal(flags.vision, true);
  assert.match(startup, /config=on/);
  assert.match(startup, /vision=on/);
  const names = runtime.get(TOOLS).list().map((t) => t.name).sort();
  assert.deepEqual(names, ["echo", "execute_command", "grep", "list_files", "read_file", "write_file"]);
  await runtime.stop();
});

test("bootRuntime rejects capabilities.web true", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({ capabilities: { web: true } }),
  });
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "run", "hi"]), cwd };
  await assert.rejects(bootRuntime(flags), (err: unknown) => {
    assert.ok(err instanceof ProjectError);
    assert.match(err.message, /web is not implemented/);
    return true;
  });
});

test("bootRuntime --no-exec overrides config coding.exec", async () => {
  const cwd = projectDir({
    "tah.config.json": JSON.stringify({ capabilities: { coding: { exec: true } } }),
  });
  const flags = {
    ...parseArgv(["--mock", "--no-persist", "--quiet", "--no-exec", "run", "hi"]),
    cwd,
  };
  const { runtime, caps } = await bootRuntime(flags);
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
  const { runtime, startup } = await bootRuntime(flags);
  assert.match(startup, /mcp=on/);
  assert.equal(runtime.get(TOOLS).listSchemas().some((t) => t.name === "ping"), true);
  await runtime.stop();
});
