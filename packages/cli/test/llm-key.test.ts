import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const execFileAsync = promisify(execFile);

function envWithoutKeys(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_BASE_URL;
  delete env.OPENAI_BASE_URL;
  delete env.DEEPSEEK_MODEL;
  delete env.OPENAI_MODEL;
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

test("a blank DEEPSEEK_API_KEY= in .env does not hide the OPENAI_* settings", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "pong" } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-key-"));
  writeFileSync(
    path.join(cwd, ".env"),
    `DEEPSEEK_API_KEY=\nOPENAI_API_KEY=sk-test\nOPENAI_BASE_URL=http://127.0.0.1:${port}/v1\n`,
  );
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cli, "--cwd", cwd, "--no-persist", "--quiet", "run", "hi"],
      { env: envWithoutKeys(), timeout: 30_000 },
    );
    assert.equal(stdout.trim(), "pong");
  } finally {
    server.close();
  }
});
