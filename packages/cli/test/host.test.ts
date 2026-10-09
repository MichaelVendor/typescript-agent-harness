import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import {
  approvalQueue,
  createChatHost,
  historyOf,
  toolResult,
  toolSummary,
  type HostEvent,
} from "../dist/host.js";

function flags(cwd: string, argv: string[] = []) {
  return { ...parseArgv(["--mock", "--no-exec", ...argv, "chat"]), cwd };
}

async function openHost(cwd: string, argv: string[] = []) {
  const host = await createChatHost(flags(cwd, argv));
  const events: HostEvent[] = [];
  host.on((e) => events.push(e));
  await host.open();
  return { host, events };
}

const kinds = (events: HostEvent[]) =>
  events.map((e) => e.type).filter((t, i, all) => t !== "text" || all[i - 1] !== "text");

test("a turn streams tool calls, text, then turn.end — all plain JSON", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  writeFileSync(path.join(cwd, "a.txt"), "x");
  const { host, events } = await openHost(cwd, ["--quiet"]);
  try {
    await host.send("看看目录");
    assert.deepEqual(kinds(events), ["session", "tool.start", "tool.end", "text", "turn.end"]);
    assert.deepEqual(events[1], {
      type: "tool.start",
      callId: (events[1] as { callId: string }).callId,
      tool: "list_files",
      summary: ".",
    });
    assert.equal((events[2] as { result: string }).result, "1 entries");
    const end = events.at(-1) as Extract<HostEvent, { type: "turn.end" }>;
    assert.equal(end.finishReason, "stop");
    assert.equal(end.rounds, 2);
    assert.equal(end.model, "mock");
    for (const e of events) assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
  } finally {
    await host.close();
  }
});

test("open emits startup notices unless --quiet", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  const { host, events } = await openHost(cwd);
  await host.close();
  assert.equal(events[0]?.type, "notice");
  assert.match((events[0] as { text: string }).text, /^\[tah\] cwd=.* llm=mock/);
  assert.equal(events.at(-1)?.type, "session");
});

test("only one turn at a time", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  const { host } = await openHost(cwd, ["--quiet"]);
  try {
    const first = host.send("one");
    await assert.rejects(host.send("two"), /a turn is running/);
    await assert.rejects(host.reset(), /a turn is running/);
    await first;
    await host.send("three");
  } finally {
    await host.close();
  }
});

test("reset, fork and resume each emit a session event with recent history", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  const { host, events } = await openHost(cwd, ["--quiet"]);
  try {
    for (const text of ["t1", "t2", "t3", "t4"]) await host.send(text);
    const first = host.sessionId;

    await host.fork(2);
    const forked = events.at(-1) as Extract<HostEvent, { type: "session" }>;
    assert.notEqual(forked.id, first);
    assert.equal(forked.hiddenTurns, 0);
    assert.deepEqual(
      forked.history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["t1", "t2"],
    );

    await host.reset();
    const fresh = events.at(-1) as Extract<HostEvent, { type: "session" }>;
    assert.equal(fresh.resumed, false);
    assert.deepEqual(fresh.history, []);

    await host.resume(first);
    const resumed = events.at(-1) as Extract<HostEvent, { type: "session" }>;
    assert.equal(resumed.id, first);
    assert.equal(resumed.hiddenTurns, 1);
    assert.deepEqual(
      resumed.history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["t2", "t3", "t4"],
    );
    assert.ok((await host.listSessions()).some((r) => r.id === first));
    await assert.rejects(host.resume("99"), /no session "99"/);
  } finally {
    await host.close();
  }
});

test("approvals wait for an answer; abort and rejectAll answer no", async () => {
  const events: HostEvent[] = [];
  const queue = approvalQueue((e) => events.push(e));
  const call = { id: "c1", name: "write_file", arguments: { path: "a.txt", content: "hi" } };

  const yes = queue.ask(call);
  const asked = events.at(-1) as Extract<HostEvent, { type: "approval" }>;
  assert.deepEqual(asked, { type: "approval", id: asked.id, tool: "write_file", input: call.arguments });
  queue.answer(asked.id, "yes");
  assert.equal(await yes, "yes");

  const controller = new AbortController();
  const aborted = queue.ask(call, controller.signal);
  controller.abort();
  assert.equal(await aborted, "no");

  const dropped = queue.ask(call);
  queue.rejectAll();
  assert.equal(await dropped, "no");
  queue.answer((events.at(-1) as { id: string }).id, "yes");
  assert.equal(await dropped, "no");
});

test("tool summaries and results", () => {
  assert.equal(toolSummary("read_file", { path: "src/a.ts" }), "src/a.ts");
  assert.equal(toolSummary("execute_command", { program: "npm", args: ["test"] }), "npm test");
  assert.equal(toolSummary("grep", { pattern: "foo", directory: "src" }), "foo in src");
  assert.equal(toolSummary("query_order", { orderId: "A1" }), '{"orderId":"A1"}');
  assert.equal(toolSummary("x", { s: "y".repeat(100) }).length, 60);

  assert.equal(toolResult("read_file", true, { content: "a\nb\nc" }), "3 lines");
  assert.equal(toolResult("execute_command", true, { exitCode: 1 }), "exit 1");
  assert.equal(toolResult("execute_command", true, { exitCode: null, timedOut: true }), "timed out");
  assert.equal(toolResult("write_file", false, { error: "rejected by user: write_file" }), "rejected by user: write_file");
  assert.equal(toolResult("query_order", false, "boom"), "boom");
  assert.equal(toolResult("query_order", true, { ok: 1 }), "done");
});

test("historyOf keeps the last turns and pairs tool calls with their results", () => {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "old" },
    { role: "assistant" as const, content: "old reply" },
    { role: "user" as const, content: "read it" },
    {
      role: "assistant" as const,
      toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.md" } }],
    },
    { role: "tool" as const, toolCallId: "c1", content: JSON.stringify({ content: "x\ny" }) },
    { role: "assistant" as const, content: "done" },
  ];
  const { history, hiddenTurns } = historyOf(messages, 1);
  assert.equal(hiddenTurns, 1);
  assert.deepEqual(history, [
    { role: "user", text: "read it" },
    { role: "tool", callId: "c1", tool: "read_file", summary: "a.md", ok: true, result: "2 lines" },
    { role: "assistant", text: "done" },
  ]);
});
