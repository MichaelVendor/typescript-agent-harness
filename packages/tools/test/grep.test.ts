import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { TOOLS, grepTool, toolsPlugin, type ToolContext } from "@typescript-agent-harness/tools";

function toolCtx(runtime: Runtime): ToolContext {
  return {
    sessionId: "s",
    callId: "c1",
    signal: new AbortController().signal,
    runtime: runtime.context(),
  };
}

test("grep finds matches and skips node_modules", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-grep-"));
  mkdirSync(path.join(dir, "src"));
  mkdirSync(path.join(dir, "node_modules"));
  writeFileSync(path.join(dir, "src", "a.ts"), "const alpha = 1;\nconst beta = 2;\n");
  writeFileSync(path.join(dir, "node_modules", "skip.js"), "alpha hidden\n");

  const runtime = new Runtime({ id: "grep-ok" });
  runtime.use(toolsPlugin({ tools: [grepTool(dir)] }));
  await runtime.start();
  const result = await runtime.get(TOOLS).execute(
    { id: "c1", name: "grep", arguments: { pattern: "alpha" } },
    toolCtx(runtime),
  );
  assert.equal(result.ok, true);
  const out = result.output as { matches: { path: string; line: number }[]; truncated: boolean };
  assert.equal(out.truncated, false);
  assert.equal(out.matches.length, 1);
  assert.equal(out.matches[0]?.path, path.join("src", "a.ts"));
  assert.equal(out.matches[0]?.line, 1);
  await runtime.stop();
});

test("grep rejects path escape and invalid pattern", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-grep-bad-"));
  const runtime = new Runtime({ id: "grep-bad" });
  runtime.use(toolsPlugin({ tools: [grepTool(dir)] }));
  await runtime.start();
  const escape = await runtime.get(TOOLS).execute(
    { id: "c1", name: "grep", arguments: { pattern: "x", directory: ".." } },
    toolCtx(runtime),
  );
  assert.equal(escape.ok, false);
  const bad = await runtime.get(TOOLS).execute(
    { id: "c2", name: "grep", arguments: { pattern: "(" } },
    toolCtx(runtime),
  );
  assert.equal(bad.ok, false);
  await runtime.stop();
});
