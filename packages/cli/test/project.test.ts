import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SESSION } from "@typescript-agent-harness/agent";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { initProject } from "../dist/init.js";
import { buildSystemPrompt } from "../dist/prompt.js";
import { loadProject, ProjectError } from "../dist/project.js";
import { bootRuntime } from "../dist/runtime.js";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const MARKER = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });

const PLAIN_TOOL = `export default {
  description: "echo",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  async execute(input) { return { echoed: input.text }; },
};
`;

function makeDir(files: Record<string, string>, marker = true): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-project-"));
  const all = marker ? { "package.json": MARKER, ...files } : files;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return cwd;
}

function flags(cwd: string, extra: string[] = []) {
  return { ...parseArgv(["--mock", "--no-persist", "--quiet", ...extra, "run", "hi"]), cwd };
}

async function boot(cwd: string, extra: string[] = []) {
  const { runtime } = await bootRuntime(flags(cwd, extra));
  const tools = runtime.get(TOOLS).list().map((t) => t.name).sort();
  const session = await runtime.get(SESSION).create();
  const system = session.messages[0]?.content ?? "";
  return { runtime, tools, system };
}

const BUILTIN = ["execute_command", "grep", "list_files", "read_file", "write_file"];

test("without the package.json marker, tools/ and AGENTS.md are ignored", async () => {
  const cwd = makeDir({ "AGENTS.md": "You are a pirate.", "tools/echo.ts": "throw new Error('must not run')" }, false);
  assert.equal(await loadProject(cwd), undefined);
  const { runtime, tools, system } = await boot(cwd);
  assert.deepEqual(tools, BUILTIN);
  assert.match(system, /workspace coding agent/);
  await runtime.stop();
});

test("AGENTS.md alone replaces the role and keeps the built-in tools and rules", async () => {
  const cwd = makeDir({ "AGENTS.md": "You are a pirate." });
  const { runtime, tools, system } = await boot(cwd);
  assert.deepEqual(tools, BUILTIN);
  assert.match(system, /^You are a pirate\.\n\nPrefer list_files/);
  assert.doesNotMatch(system, /workspace coding agent/);
  await runtime.stop();
});

test("--system-file wins over AGENTS.md", async () => {
  const cwd = makeDir({ "AGENTS.md": "You are a pirate.", "role.md": "You are a reviewer." });
  const { runtime, system } = await boot(cwd, ["--system-file", path.join(cwd, "role.md")]);
  assert.match(system, /^You are a reviewer\./);
  assert.doesNotMatch(system, /pirate/);
  await runtime.stop();
});

test("tools/: names come from file names, built-ins are off, the tool runs", async () => {
  const cwd = makeDir({
    "AGENTS.md": "You are a pirate.",
    "tools/echo-text.ts": PLAIN_TOOL,
    "tools/named.mjs": PLAIN_TOOL.replace('description: "echo"', 'name: "custom_name", description: "echo"'),
    "tools/_helper.ts": "throw new Error('must not run')",
    "tools/echo.test.ts": "throw new Error('must not run')",
    "tools/nested/inner.ts": "throw new Error('must not run')",
  });
  const { runtime, tools, system } = await boot(cwd);
  assert.deepEqual(tools, ["custom_name", "echo_text"]);
  assert.equal(system, "You are a pirate.");
  const result = await runtime.get(TOOLS).execute(
    { id: "c1", name: "echo_text", arguments: { text: "hi" } },
    { sessionId: "s", callId: "c1", signal: new AbortController().signal, runtime: runtime.context() },
  );
  assert.deepEqual(result.output, { echoed: "hi" });
  await runtime.stop();
});

test("--builtin-tools keeps the built-ins next to tools/", async () => {
  const cwd = makeDir({ "tools/echo.ts": PLAIN_TOOL });
  const { runtime, tools } = await boot(cwd, ["--builtin-tools"]);
  assert.deepEqual(tools, [...BUILTIN, "echo"].sort());
  await runtime.stop();
});

test("tools/ without AGENTS.md uses the generic project role", () => {
  const prompt = buildSystemPrompt({ exec: false, mcp: false, builtinTools: false });
  assert.doesNotMatch(prompt, /coding agent|list_files|--no-exec/);
});

test("defineTool from the CLI package and ../lib imports load through jiti", async () => {
  const cwd = makeDir({
    "lib/greet.ts": "export const greet = (name: string): string => `hi ${name}`;\n",
    "tools/greet.ts": `import { defineTool } from "@typescript-agent-harness/cli";
import { greet } from "../lib/greet.ts";

export default defineTool({
  description: "greet",
  inputSchema: { type: "object", properties: { name: { type: "string" } } },
  async execute(input: { name: string }) {
    return greet(input.name);
  },
});
`,
  });
  mkdirSync(path.join(cwd, "node_modules/@typescript-agent-harness"), { recursive: true });
  symlinkSync(cliRoot, path.join(cwd, "node_modules/@typescript-agent-harness/cli"), "dir");
  const project = await loadProject(cwd);
  const greet = project?.tools[0]?.tool;
  assert.equal(greet?.name, "greet");
  assert.equal(await greet?.execute({ name: "Ann" }, {} as never), "hi Ann");
});

test("plugins/ register last, in file name order, and can add tools", async () => {
  const cwd = makeDir({
    "plugins/02-second.mjs": "export default { setup() {} };",
    "plugins/01-first.mjs": `export default {
  setup(ctx) {
    ctx.get({ id: "tools" }).register({
      name: "from_plugin",
      description: "x",
      inputSchema: { type: "object" },
      async execute() { return 1; },
    });
  },
};`,
  });
  const project = await loadProject(cwd);
  assert.deepEqual(project?.plugins.map((p) => p.name), ["project:01-first", "project:02-second"]);
  const { runtime, tools } = await boot(cwd);
  assert.ok(tools.includes("from_plugin"));
  await runtime.stop();
});

async function rejects(files: Record<string, string>, pattern: RegExp, extra: string[] = []) {
  const cwd = makeDir(files);
  await assert.rejects(bootRuntime(flags(cwd, extra)), (err: unknown) => {
    assert.ok(err instanceof ProjectError);
    assert.match(err.message, pattern);
    return true;
  });
}

test("project errors name the file", async () => {
  await rejects({ "tools/broken.ts": "export default {" }, /failed to load tools\/broken\.ts/);
  await rejects({ "tools/empty.ts": "export const x = 1;" }, /tools\/empty\.ts must export default defineTool/);
  await rejects({ "tools/Bad.ts": PLAIN_TOOL }, /tools\/Bad\.ts: tool name "Bad" is invalid/);
  await rejects(
    { "tools/a-b.ts": PLAIN_TOOL, "tools/a_b.ts": PLAIN_TOOL },
    /tools\/a-b\.ts and tools\/a_b\.ts both define tool "a_b"/,
  );
  await rejects({ "tools/read-file.ts": PLAIN_TOOL }, /tools\/read-file\.ts: tool "read_file" is built in/, [
    "--builtin-tools",
  ]);
  await rejects({ "plugins/p.mjs": "export default {}" }, /plugins\/p\.mjs must export default definePlugin/);
});

test("tah init scaffolds a project and never overwrites", () => {
  const cwd = makeDir({ "AGENTS.md": "mine" }, false);
  const out = initProject(cwd).join("\n");
  assert.match(out, /skip {4}AGENTS\.md/);
  assert.match(out, /create {2}tools\/current-time\.ts/);
  assert.equal(readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), "mine");
  const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  assert.ok(pkg.devDependencies["@typescript-agent-harness/cli"]);
  assert.doesNotMatch(out, /does not depend on/);
});
