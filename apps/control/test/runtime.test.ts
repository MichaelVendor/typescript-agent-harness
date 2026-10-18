import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createDockerRuntime,
  dockerRunArgs,
  RuntimeNotReadyError,
  sweepIdle,
} from "../dist/runtime.js";

test("dockerRunArgs names the container, bind-mounts workspace, and denies exec and writes", () => {
  const dataDir = "/tmp/control-data";
  const projectId = "abc-123";
  const args = dockerRunArgs({
    projectId,
    dataDir,
    image: "tah-agent-host",
    secret: "shared-secret",
  });

  assert.equal(args.includes("-p"), false);
  assert.equal(args.includes("--publish"), false);
  assert.deepEqual(args, [
    "run",
    "-d",
    "--name",
    "tah-project-abc-123",
    "-v",
    `${path.resolve(dataDir)}/projects/${projectId}/workspace:/workspace`,
    "-e",
    "AR_SHARED_SECRET=shared-secret",
    "-e",
    "TAH_PROJECT_ID=abc-123",
    "tah-agent-host",
    "tah",
    "agent-host",
    "--cwd",
    "/workspace",
    "--host",
    "0.0.0.0",
    "--port",
    "7800",
    "--project-id",
    "abc-123",
    "--yes",
    "--no-exec",
    "--deny",
    "execute_command",
    "--deny",
    "write_file",
    "--deny",
    "edit_file",
  ]);
});

test("dockerRunArgs injects model keys only when present", () => {
  const base = {
    projectId: "p1",
    dataDir: "/data",
    image: "tah-agent-host",
    secret: "s",
  };
  const without = dockerRunArgs(base).join("\0");
  assert.equal(without.includes("DEEPSEEK_API_KEY"), false);
  assert.equal(without.includes("OPENAI_API_KEY"), false);

  const withKeys = dockerRunArgs({
    ...base,
    deepseekApiKey: "sk-ds",
    openaiApiKey: "sk-oa",
  });
  assert.ok(withKeys.includes("DEEPSEEK_API_KEY=sk-ds"));
  assert.ok(withKeys.includes("OPENAI_API_KEY=sk-oa"));
});

test("createDockerRuntime runs then starts; stop does not rm; never calls docker binary", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-"));
  const projectId = "proj-1";
  const name = `tah-project-${projectId}`;
  const calls: string[][] = [];
  const boxes = new Map<string, { status: string; ip: string }>();

  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "inspect") {
      const box = boxes.get(args.at(-1)!);
      if (!box) return { code: 1, stdout: "", stderr: "No such object" };
      const flag = args.indexOf("-f");
      const fmt = flag >= 0 ? args[flag + 1]! : "";
      const value = fmt.includes("IPAddress") ? box.ip : box.status;
      return { code: 0, stdout: `${value}\n`, stderr: "" };
    }
    if (args[0] === "run") {
      const n = args[args.indexOf("--name") + 1]!;
      boxes.set(n, { status: "running", ip: "172.17.0.2" });
      return { code: 0, stdout: "cid\n", stderr: "" };
    }
    if (args[0] === "start") {
      const box = boxes.get(args[1]!);
      if (!box) return { code: 1, stdout: "", stderr: "missing" };
      box.status = "running";
      return { code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    if (args[0] === "stop") {
      const box = boxes.get(args[1]!);
      if (box) box.status = "exited";
      return { code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };

  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "shared",
    exec,
    fetchHealth: async () => true,
  });

  const first = await runtime.ensure(projectId);
  assert.equal(first.baseUrl, "http://172.17.0.2:7800");
  assert.ok(calls.some((a) => a[0] === "run"));
  assert.equal(calls.some((a) => a.includes("-p")), false);
  const run = calls.find((a) => a[0] === "run")!;
  assert.deepEqual(
    run,
    dockerRunArgs({ projectId, dataDir, image: "tah-agent-host", secret: "shared" }),
  );

  await runtime.stop(projectId);
  assert.ok(calls.some((a) => a[0] === "stop" && a[1] === name));
  assert.equal(calls.some((a) => a[0] === "rm"), false);

  calls.length = 0;
  const second = await runtime.ensure(projectId);
  assert.equal(second.baseUrl, "http://172.17.0.2:7800");
  assert.ok(calls.some((a) => a[0] === "start" && a[1] === name));
  assert.equal(calls.some((a) => a[0] === "run"), false);
});

test("createDockerRuntime times out when health never succeeds", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-to-"));
  const calls: string[][] = [];
  const lastTouch = new Map<string, number>();
  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "inspect") return { code: 1, stdout: "", stderr: "missing" };
    if (args[0] === "run") return { code: 0, stdout: "cid\n", stderr: "" };
    if (args[0] === "stop") return { code: 0, stdout: "tah-project-late\n", stderr: "" };
    return { code: 0, stdout: "172.17.0.9\n", stderr: "" };
  };
  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "s",
    exec,
    fetchHealth: async () => false,
    timeoutMs: 0,
    sleep: async () => {},
    lastTouch,
  });
  await assert.rejects(() => runtime.ensure("late"), (err: unknown) => {
    assert.ok(err instanceof RuntimeNotReadyError);
    return true;
  });
  assert.ok(calls.some((a) => a[0] === "stop" && a[1] === "tah-project-late"));
  assert.equal(lastTouch.has("late"), false);
});

test("health timeout records the project when docker stop fails", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-stop-"));
  const lastTouch = new Map<string, number>();
  const exec = async (args: string[]) => {
    if (args[0] === "inspect") return { code: 1, stdout: "", stderr: "missing" };
    if (args[0] === "run") return { code: 0, stdout: "cid\n", stderr: "" };
    if (args[0] === "stop") return { code: 1, stdout: "", stderr: "stop failed" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "s",
    exec,
    fetchHealth: async () => false,
    timeoutMs: 0,
    sleep: async () => {},
    now: () => 5_000,
    lastTouch,
  });
  await assert.rejects(() => runtime.ensure("late"), (err: unknown) => {
    assert.ok(err instanceof RuntimeNotReadyError);
    return true;
  });
  assert.equal(lastTouch.get("late"), 5_000);
});

test("docker run name conflict starts the existing container", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-name-"));
  const projectId = "proj-race";
  const name = `tah-project-${projectId}`;
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "inspect") {
      const fmt = args[args.indexOf("-f") + 1] ?? "";
      if (fmt.includes("IPAddress")) return { code: 0, stdout: "172.17.0.4\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "No such object" };
    }
    if (args[0] === "run") {
      return {
        code: 1,
        stdout: "",
        stderr: `Conflict. The container name "/${name}" is already in use by container "abc".\n`,
      };
    }
    if (args[0] === "start") return { code: 0, stdout: `${name}\n`, stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "s",
    exec,
    fetchHealth: async () => true,
  });
  const ready = await runtime.ensure(projectId);
  assert.equal(ready.baseUrl, "http://172.17.0.4:7800");
  assert.ok(calls.some((a) => a[0] === "start" && a[1] === name));
});

test("idle sweep keeps the project when docker stop fails", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-sweep-"));
  const lastTouch = new Map<string, number>();
  const exec = async (args: string[]) => {
    if (args[0] === "stop") return { code: 1, stdout: "", stderr: "cannot stop" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "s",
    exec,
    now: () => 80_000,
    lastTouch,
  });
  lastTouch.set("p", 0);
  sweepIdle(runtime, lastTouch, 80_000, 30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lastTouch.get("p"), 80_000);
});

test("docker run failure that is not a name conflict does not start", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "tah-control-docker-run-"));
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "inspect") return { code: 1, stdout: "", stderr: "No such object" };
    if (args[0] === "run") return { code: 1, stdout: "", stderr: "Unable to find image" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = createDockerRuntime({
    dataDir,
    image: "tah-agent-host",
    secret: "s",
    exec,
    fetchHealth: async () => true,
  });
  await assert.rejects(() => runtime.ensure("missing-image"), /Unable to find image/);
  assert.equal(calls.some((a) => a[0] === "start"), false);
});

test("main exits 1 when AR_SHARED_SECRET is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tah-control-main-"));
  const env = { ...process.env, CONTROL_DATA: dir, CONTROL_PORT: "0" };
  delete env.AR_SHARED_SECRET;
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "../dist/main.js")], {
    env,
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AR_SHARED_SECRET/);
});
