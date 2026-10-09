import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function envWithoutKeys(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_BASE_URL;
  delete env.OPENAI_BASE_URL;
  return env;
}

test("piped tah chat runs two turns then exits 0", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-chat-"));
  const result = spawnSync(process.execPath, [cli, "--mock", "--cwd", cwd, "--quiet", "chat"], {
    encoding: "utf8",
    input: "hello\nsecond\n",
    env: envWithoutKeys(),
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /readline was closed/i);
  assert.doesNotMatch(result.stderr, /ExperimentalWarning|SQLite/);
});
