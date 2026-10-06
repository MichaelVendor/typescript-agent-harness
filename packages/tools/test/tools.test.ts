import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { permissionsPlugin } from "@typescript-agent-harness/permissions";
import {
  TOOLS,
  toolsPlugin,
  writeFileTool,
  type ToolContext,
} from "@typescript-agent-harness/tools";

function toolCtx(runtime: Runtime): ToolContext {
  return {
    sessionId: "s",
    callId: "c1",
    signal: new AbortController().signal,
    runtime: runtime.context(),
  };
}

test("unknown tool execute emits tool.failed and returns ok:false", async () => {
  const failed: unknown[] = [];
  const runtime = new Runtime({ id: "tools-unknown" });
  runtime.use(toolsPlugin());
  runtime.on("tool.failed", (e) => {
    failed.push(e);
  });
  await runtime.start();

  const result = await runtime.get(TOOLS).execute(
    { id: "c1", name: "nope", arguments: {} },
    toolCtx(runtime),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.output, { error: "unknown tool: nope" });
  assert.equal(failed.length, 1);
  await runtime.stop();
});

test("denied tool is hidden and execute emits permission.denied", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-perm-"));
  const denied: unknown[] = [];
  const runtime = new Runtime({ id: "tools-deny" });
  runtime
    .use(permissionsPlugin({ deny: ["write_file"] }))
    .use(toolsPlugin({ tools: [writeFileTool(dir)] }));
  runtime.on("permission.denied", (e) => {
    denied.push(e);
  });
  await runtime.start();

  const tools = runtime.get(TOOLS);
  assert.equal(
    tools.listSchemas().some((t) => t.name === "write_file"),
    false,
  );

  const result = await tools.execute(
    {
      id: "c1",
      name: "write_file",
      arguments: { path: "x.txt", content: "no" },
    },
    toolCtx(runtime),
  );

  assert.equal(result.ok, false);
  assert.equal(denied.length, 1);
  await runtime.stop();
});
