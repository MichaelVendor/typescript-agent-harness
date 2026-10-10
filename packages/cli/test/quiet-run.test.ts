import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("tah run --quiet prints only the final reply, not what the model says before calling tools", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-quiet-"));
  writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } }),
  );
  mkdirSync(path.join(cwd, "plugins"));
  // Stands in for a model that streams "let me look" before its tool call.
  writeFileSync(
    path.join(cwd, "plugins/narrate.ts"),
    `export default { setup(ctx) { ctx.on("tool.started", () => ctx.emit("agent.assistant-stream", { text: "Let me look first." })); } };`,
  );
  const run = spawnSync(process.execPath, [cli, "--mock", "--no-persist", "--quiet", "--cwd", cwd, "run", "列出当前目录"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /Let me look first/);
  assert.doesNotMatch(run.stdout, /^\s*$/);
  assert.equal(run.stdout, `${run.stdout.trim()}\n`);
});
