import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { permissionsPlugin } from "@typescript-agent-harness/permissions";
import {
  TOOLS,
  executeCommandTool,
  toolsPlugin,
  type ToolContext,
} from "@typescript-agent-harness/tools";

function toolCtx(runtime: Runtime, signal?: AbortSignal): ToolContext {
  return {
    sessionId: "s",
    callId: "c1",
    signal: signal ?? new AbortController().signal,
    runtime: runtime.context(),
  };
}

test("execute_command runs a program in the workspace cwd", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-"));
  const runtime = new Runtime({ id: "exec-ok" });
  runtime.use(
    toolsPlugin({
      tools: [executeCommandTool(dir)],
    }),
  );
  await runtime.start();
  const result = await runtime.get(TOOLS).execute(
    {
      id: "c1",
      name: "execute_command",
      arguments: {
        program: process.execPath,
        args: ["-e", "process.stdout.write(require('node:fs').realpathSync('.'))"],
      },
    },
    toolCtx(runtime),
  );
  assert.equal(result.ok, true);
  const out = result.output as { exitCode: number; stdout: string };
  assert.equal(out.exitCode, 0);
  assert.equal(out.stdout.trim(), realpathSync(dir));
  await runtime.stop();
});

test("denied execute_command is hidden and execute emits permission.denied", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-deny-"));
  const denied: unknown[] = [];
  const runtime = new Runtime({ id: "exec-deny" });
  runtime
    .use(permissionsPlugin({ deny: ["execute_command"] }))
    .use(toolsPlugin({ tools: [executeCommandTool(dir)] }));
  runtime.on("permission.denied", (e) => {
    denied.push(e);
  });
  await runtime.start();
  const tools = runtime.get(TOOLS);
  assert.equal(
    tools.listSchemas().some((t) => t.name === "execute_command"),
    false,
  );
  const result = await tools.execute(
    {
      id: "c1",
      name: "execute_command",
      arguments: { program: process.execPath, args: ["-e", "process.exit(0)"] },
    },
    toolCtx(runtime),
  );
  assert.equal(result.ok, false);
  assert.equal(denied.length, 1);
  await runtime.stop();
});

test("execute_command times out and does not hang", { timeout: 4000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-to-"));
  const runtime = new Runtime({ id: "exec-timeout" });
  runtime.use(
    toolsPlugin({
      tools: [executeCommandTool(dir, { timeoutMs: 200 })],
    }),
  );
  await runtime.start();
  const started = Date.now();
  const result = await runtime.get(TOOLS).execute(
    {
      id: "c1",
      name: "execute_command",
      arguments: {
        program: process.execPath,
        args: ["-e", "setTimeout(() => {}, 30000)"],
      },
    },
    toolCtx(runtime),
  );
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.ok, true);
  const out = result.output as { timedOut: boolean };
  assert.equal(out.timedOut, true);
  await runtime.stop();
});

test("execute_command: per-call timeoutMs overrides the default; invalid values fall back", { timeout: 6000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-to2-"));
  const runtime = new Runtime({ id: "exec-timeout-per-call" });
  runtime.use(toolsPlugin({ tools: [executeCommandTool(dir, { timeoutMs: 200 })] }));
  await runtime.start();
  const run = async (timeoutMs: unknown, script: string) => {
    const started = Date.now();
    const result = await runtime.get(TOOLS).execute(
      {
        id: "c1",
        name: "execute_command",
        arguments: { program: process.execPath, args: ["-e", script], timeoutMs },
      },
      toolCtx(runtime),
    );
    return { out: result.output as { timedOut: boolean; exitCode: number | null }, ms: Date.now() - started };
  };

  const longer = await run(3000, "setTimeout(() => {}, 600)");
  assert.equal(longer.out.timedOut, false);
  assert.equal(longer.out.exitCode, 0);

  const invalid = await run(0, "setTimeout(() => {}, 30000)");
  assert.equal(invalid.out.timedOut, true);
  assert.ok(invalid.ms < 3000);
  await runtime.stop();
});

test("execute_command stops when the call is aborted", { timeout: 4000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-abort-"));
  const runtime = new Runtime({ id: "exec-abort" });
  runtime.use(toolsPlugin({ tools: [executeCommandTool(dir)] }));
  await runtime.start();
  const ac = new AbortController();
  const started = Date.now();
  const pending = runtime.get(TOOLS).execute(
    {
      id: "c1",
      name: "execute_command",
      arguments: {
        program: process.execPath,
        args: ["-e", "setTimeout(() => {}, 30000)"],
      },
    },
    toolCtx(runtime, ac.signal),
  );
  setTimeout(() => ac.abort(), 80);
  const result = await pending;
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.ok, true);
  const out = result.output as { timedOut: boolean };
  assert.equal(out.timedOut, false);
  await runtime.stop();
});

function fakeStream(text: string): Readable {
  const stream = new Readable({ read() {} });
  const original = stream.on.bind(stream);
  let delivered = false;
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    const result = original(event, listener as never);
    if (event === "data" && !delivered) {
      delivered = true;
      if (text) listener(Buffer.from(text));
    }
    return result;
  }) as typeof stream.on;
  return stream;
}

function fakeChild(code: number, stdout: string, stderr: string) {
  return {
    stdout: fakeStream(stdout),
    stderr: fakeStream(stderr),
    kill() {},
    on(event: string, listener: (value?: number | null) => void) {
      if (event === "close") listener(code);
      return this;
    },
  };
}

function sandboxCtx(): ToolContext {
  return toolCtx(new Runtime({ id: "exec-sandbox" }));
}

test("sandbox off spawns the program itself", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-off-"));
  let file = "";
  let sawEnv: unknown = "unset";
  const tool = executeCommandTool(dir, {
    sandbox: false,
    spawn: ((bin: string, _args: string[], options?: { env?: unknown }) => {
      file = bin;
      sawEnv = options?.env;
      return fakeChild(0, "", "");
    }) as never,
  });
  await tool.execute({ program: "node", args: ["-v"] }, sandboxCtx());
  assert.equal(file, "node");
  assert.equal(sawEnv, undefined);
});

test("missing helper throws and does not spawn", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-miss-"));
  let spawned = false;
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "darwin",
    lookup: () => undefined,
    spawn: (() => {
      spawned = true;
      return fakeChild(0, "", "");
    }) as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "node" }, sandboxCtx()),
    /shell sandbox unavailable: sandbox-exec/,
  );
  assert.equal(spawned, false);
});

test("ready file present returns the program exit code", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-ready-"));
  let ready = "";
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "linux",
    homedir: "/home/me",
    lookup: () => "/usr/bin/bwrap",
    realpath: (p: string) => p,
    exists: () => true,
    spawn: ((bin: string, args: string[], options?: { env?: unknown }) => {
      assert.equal(bin, "/usr/bin/bwrap");
      assert.equal(options?.env, undefined);
      ready = args[args.indexOf("/bin/sh") + 4];
      writeFileSync(ready, "");
      return fakeChild(1, "", "");
    }) as never,
  });
  const out = await tool.execute({ program: "/usr/bin/node", args: ["-e", "1"] }, sandboxCtx());
  assert.equal(out.exitCode, 1);
  assert.equal(existsSync(ready), false);
});

test("ready file absent is a helper failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-fail-"));
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "darwin",
    lookup: () => "/usr/bin/sandbox-exec",
    realpath: (file: string) => {
      assert.ok(file.includes("/"), `realpath should see a resolved path, got ${file}`);
      return "/usr/bin/node";
    },
    exists: () => true,
    spawn: () => fakeChild(1, "", "sandbox-exec: profile compilation failed\n") as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "node" }, sandboxCtx()),
    /shell sandbox failed: sandbox-exec: profile compilation failed/,
  );
});

test("ready file absent with empty stderr uses the exit code", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-exit-"));
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "linux",
    lookup: () => "/usr/bin/bwrap",
    realpath: (p: string) => p,
    exists: () => true,
    spawn: () => fakeChild(3, "", "") as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "/bin/echo" }, sandboxCtx()),
    /shell sandbox failed: exit 3/,
  );
});

test("missing user program is spawned instead of reported as a missing helper", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-user-"));
  let file = "";
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "darwin",
    lookup: (name: string) => (name === "sandbox-exec" ? "/usr/bin/sandbox-exec" : undefined),
    spawn: ((bin: string) => {
      file = bin;
      return fakeChild(0, "", "");
    }) as never,
  });
  await tool.execute({ program: "missing-bin" }, sandboxCtx());
  assert.equal(file, "missing-bin");
});

test("windows sandbox throws before spawn", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-exec-sbx-win-"));
  let spawned = false;
  const tool = executeCommandTool(dir, {
    sandbox: true,
    platform: "win32",
    spawn: (() => {
      spawned = true;
      return fakeChild(0, "", "");
    }) as never,
  });
  await assert.rejects(
    () => tool.execute({ program: "node" }, sandboxCtx()),
    /shell sandbox is unavailable on windows/,
  );
  assert.equal(spawned, false);
});
