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

test("tah run without a key exits 1 unless --mock", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-key-"));
  const env = envWithoutKeys();
  const missing = spawnSync(process.execPath, [cli, "--cwd", cwd, "run", "hi"], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DEEPSEEK_API_KEY|OPENAI_API_KEY|--mock/);
  assert.doesNotMatch(missing.stdout, /llm=mock/);

  const mocked = spawnSync(process.execPath, [cli, "--mock", "--cwd", cwd, "--quiet", "run", "hi"], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  assert.equal(mocked.status, 0, mocked.stderr);
});
