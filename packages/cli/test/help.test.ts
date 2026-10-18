import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("tah --version / -v / version print the package version", () => {
  for (const arg of ["--version", "-v", "version"]) {
    const result = spawnSync(process.execPath, [cli, arg], { encoding: "utf8" });
    assert.equal(result.status, 0, arg);
    assert.equal(result.stdout.trim(), pkg.version, arg);
  }
});

test("tah --help does not load node:sqlite", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /tah agent-host/);
  assert.doesNotMatch(result.stderr, /sqlite/i);
  assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
});

function agentHostEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.DEEPSEEK_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_BASE_URL;
  delete env.OPENAI_BASE_URL;
  if (extra.AR_SHARED_SECRET === undefined) delete env.AR_SHARED_SECRET;
  if (extra.TAH_PROJECT_ID === undefined) delete env.TAH_PROJECT_ID;
  env.HOME = mkdtempSync(path.join(tmpdir(), "tah-ah-home-"));
  return env;
}

test("tah agent-host requires AR_SHARED_SECRET and a project id", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ah-"));
  const noSecret = spawnSync(process.execPath, [cli, "--cwd", cwd, "--mock", "agent-host"], {
    encoding: "utf8",
    env: agentHostEnv({ TAH_PROJECT_ID: "p" }),
  });
  assert.equal(noSecret.status, 1);
  assert.match(noSecret.stderr, /AR_SHARED_SECRET/);

  const env = agentHostEnv({ AR_SHARED_SECRET: "x" });
  delete env.TAH_PROJECT_ID;
  const noProject = spawnSync(process.execPath, [cli, "--cwd", cwd, "--mock", "agent-host"], {
    encoding: "utf8",
    env,
  });
  assert.equal(noProject.status, 1);
  assert.match(noProject.stderr, /TAH_PROJECT_ID|--project-id/);
});

test("tah agent-host starts without an LLM key and prints the listen URL", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ah-"));
  const child = spawn(
    process.execPath,
    [cli, "--cwd", cwd, "--host", "127.0.0.1", "--port", "0", "agent-host"],
    {
      env: agentHostEnv({ AR_SHARED_SECRET: "x", TAH_PROJECT_ID: "p" }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${stdout}\n${stderr}`)), 15_000);
      const onData = () => {
        if (stdout.includes("AgentHost listening on")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout?.on("data", onData);
      onData();
    });
    assert.match(stdout, /AgentHost listening on http:\/\/127\.0\.0\.1:\d+/);
    assert.doesNotMatch(stdout, /token=/);
  } finally {
    child.kill("SIGINT");
  }
  assert.equal(await exit, 0, stderr);
});
