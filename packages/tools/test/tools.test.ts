import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import {
  approvalPlugin,
  permissionsPlugin,
  type ApprovalAnswer,
} from "@typescript-agent-harness/permissions";
import {
  TOOLS,
  editFileTool,
  todoWriteTool,
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

test("approval asks for gated tools: no rejects, always stops asking", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-approve-"));
  const answers: ApprovalAnswer[] = ["no", "always"];
  const asked: string[] = [];
  const runtime = new Runtime({ id: "tools-approve" });
  runtime
    .use(permissionsPlugin({ deny: ["list_files"] }))
    .use(
      approvalPlugin({
        tools: ["write_file", "list_files"],
        async ask(call) {
          asked.push(call.name);
          return answers.shift() ?? "no";
        },
      }),
    )
    .use(toolsPlugin({ tools: [writeFileTool(dir)] }));
  await runtime.start();
  const tools = runtime.get(TOOLS);
  const write = (content: string) =>
    tools.execute(
      { id: "c1", name: "write_file", arguments: { path: "x.txt", content } },
      toolCtx(runtime),
    );

  const rejected = await write("a");
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.output), /rejected by user/);
  assert.equal((await write("b")).ok, true);
  assert.equal((await write("c")).ok, true);
  assert.deepEqual(asked, ["write_file", "write_file"]);

  const policyDenied = await tools.execute(
    { id: "c2", name: "list_files", arguments: {} },
    toolCtx(runtime),
  );
  assert.equal(policyDenied.ok, false);
  assert.deepEqual(asked, ["write_file", "write_file"]);
  await runtime.stop();
});

test("todo_write returns the trimmed list and rejects bad items", async () => {
  const runtime = new Runtime({ id: "tools-todo" });
  runtime.use(toolsPlugin({ tools: [todoWriteTool()] }));
  await runtime.start();
  const write = (todos: unknown) =>
    runtime.get(TOOLS).execute({ id: "c1", name: "todo_write", arguments: { todos } }, toolCtx(runtime));

  const ok = await write([
    { content: " read code ", status: "completed" },
    { content: "fix bug", status: "in_progress" },
  ]);
  assert.deepEqual(ok.output, {
    todos: [
      { content: "read code", status: "completed" },
      { content: "fix bug", status: "in_progress" },
    ],
  });
  assert.match(JSON.stringify((await write([{ content: " ", status: "pending" }])).output), /content must be/);
  assert.match(JSON.stringify((await write([{ content: "x", status: "done" }])).output), /status must be/);
  assert.match(JSON.stringify((await write("x")).output), /must be an array/);
  await runtime.stop();
});

test("edit_file replaces a unique match, refuses ambiguous or missing text", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-edit-"));
  const file = path.join(dir, "a.txt");
  writeFileSync(file, "one $x\ntwo\none $x\n");
  const runtime = new Runtime({ id: "tools-edit" });
  runtime.use(toolsPlugin({ tools: [editFileTool(dir)] }));
  await runtime.start();
  const tools = runtime.get(TOOLS);
  const edit = (args: Record<string, unknown>) =>
    tools.execute({ id: "c1", name: "edit_file", arguments: { path: "a.txt", ...args } }, toolCtx(runtime));

  const ambiguous = await edit({ old_string: "one $x", new_string: "1" });
  assert.match(JSON.stringify(ambiguous.output), /matches 2 times/);
  assert.match(JSON.stringify((await edit({ old_string: "three", new_string: "3" })).output), /not found/);
  assert.match(JSON.stringify((await edit({ old_string: "", new_string: "3" })).output), /use write_file/);
  assert.equal(readFileSync(file, "utf8"), "one $x\ntwo\none $x\n");

  const one = await edit({ old_string: "two", new_string: "$& 2" });
  assert.deepEqual(one.output, { path: "a.txt", replacements: 1 });
  const all = await edit({ old_string: "one $x", new_string: "1", replace_all: true });
  assert.deepEqual(all.output, { path: "a.txt", replacements: 2 });
  assert.equal(readFileSync(file, "utf8"), "1\n$& 2\n1\n");
  assert.equal((await edit({ path: "../out.txt", old_string: "a", new_string: "b" })).ok, false);
  await runtime.stop();
});

test("unregister removes a tool; the name can be registered again", async () => {
  const runtime = new Runtime({ id: "t" });
  runtime.use(toolsPlugin({ tools: [] }));
  await runtime.start();
  const tools = runtime.get(TOOLS);
  const echo = { name: "echo", description: "e", inputSchema: { type: "object" as const }, async execute() { return "x"; } };
  tools.register(echo);
  tools.unregister("echo");
  tools.unregister("missing");
  assert.deepEqual(tools.listSchemas().map((t) => t.name), []);
  tools.register(echo);
  assert.deepEqual(tools.listSchemas().map((t) => t.name), ["echo"]);
  await runtime.stop();
});
