import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
