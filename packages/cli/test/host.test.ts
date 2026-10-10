import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import {
  approvalQueue,
  createChatHost,
  historyOf,
  rememberAlways,
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
    assert.deepEqual(kinds(events), ["session", "user", "tool.start", "tool.end", "text", "turn.end"]);
    assert.deepEqual(events[1], { type: "user", text: "看看目录" });
    assert.deepEqual(events[2], {
      type: "tool.start",
      callId: (events[2] as { callId: string }).callId,
      tool: "list_files",
      summary: ".",
    });
    assert.equal((events[3] as { result: string }).result, "1 entries");
    assert.equal((events[3] as { summary: string }).summary, ".");
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
  assert.deepEqual(events.at(-1), { type: "approval.end", id: asked.id, answer: "yes" });

  const controller = new AbortController();
  const aborted = queue.ask(call, controller.signal);
  controller.abort();
  assert.equal(await aborted, "no");

  assert.equal(events.at(-1)?.type, "approval.end");

  const dropped = queue.ask(call);
  const droppedId = (events.at(-1) as { id: string }).id;
  queue.rejectAll();
  assert.equal(await dropped, "no");
  assert.deepEqual(events.at(-1), { type: "approval.end", id: droppedId, answer: "no" });
  queue.answer(droppedId, "yes");
  assert.equal(await dropped, "no");
  assert.equal(events.filter((e) => e.type === "approval.end").length, 3);
});

test("snapshot returns the current session without emitting; historyTurns sets its length", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-host-"));
  const host = await createChatHost(flags(cwd, ["--quiet"]), { historyTurns: Infinity });
  const events: HostEvent[] = [];
  host.on((e) => events.push(e));
  await host.open();
  try {
    for (const text of ["t1", "t2", "t3", "t4"]) await host.send(text);
    const before = events.length;
    const snap = host.snapshot();
    assert.equal(events.length, before);
    assert.equal(snap.id, host.sessionId);
    assert.equal(snap.hiddenTurns, 0);
    assert.deepEqual(
      snap.history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["t1", "t2", "t3", "t4"],
    );
  } finally {
    await host.close();
  }
});

const MARKER = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gates = globalThis as { tahToolGate?: Promise<void>; tahDisposeGate?: Promise<void>; tahDisposing?: boolean };

/** The mock model calls `list_files`, so this project tool shows which version ran: "<n> entries". */
const listTool = (n: number) => `export default {
  description: "list",
  inputSchema: { type: "object", properties: { directory: { type: "string" } } },
  async execute() {
    await globalThis.tahToolGate;
    return { entries: Array.from({ length: ${n} }, (_, i) => ({ name: "f" + i, type: "file" })) };
  },
};
`;

function makeProject(files: Record<string, string> = {}): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-reload-"));
  const all = { "package.json": MARKER, "AGENTS.md": "You are v1.", "tools/list-files.ts": listTool(1), ...files };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    writeFileSync(path.join(cwd, rel), content);
  }
  return cwd;
}

/** File watchers take a moment to start (FSEvents on macOS); edits right after open would be missed. */
async function openWatching(cwd: string, argv: string[]) {
  const opened = await openHost(cwd, argv);
  await sleep(300);
  return opened;
}

async function waitFor(events: HostEvent[], match: (e: HostEvent) => boolean, from = 0): Promise<HostEvent> {
  for (let waited = 0; waited < 5000; waited += 25) {
    const hit = events.slice(from).find(match);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error(`timed out waiting for an event; got ${JSON.stringify(events.slice(from))}`);
}

const notice = (re: RegExp) => (e: HostEvent) => e.type === "notice" && re.test(e.text);
const lastResult = (events: HostEvent[]) =>
  (events.filter((e) => e.type === "tool.end").at(-1) as { result: string } | undefined)?.result;

function systemPrompt(cwd: string, id: string): string {
  const db = new DatabaseSync(path.join(cwd, ".tah", "cli.db"));
  const row = db.prepare("SELECT messages_json FROM sessions WHERE id = ?").get(id) as { messages_json: string };
  db.close();
  return JSON.parse(row.messages_json)[0].content;
}

test("editing a tool or AGENTS.md reloads between turns and keeps the session", async () => {
  const cwd = makeProject();
  const { host, events } = await openWatching(cwd, ["--quiet"]);
  try {
    await host.send("a");
    assert.equal(lastResult(events), "1 entries");
    const id = host.sessionId;

    const from = events.length;
    writeFileSync(path.join(cwd, "tools/list-files.ts"), listTool(2));
    writeFileSync(path.join(cwd, "AGENTS.md"), "You are v2.");
    await waitFor(events, notice(/^\[tah\] reloaded: AGENTS\.md tools\+1 plugins\+0$/), from);
    assert.equal(host.sessionId, id);
    assert.equal(events.slice(from).filter((e) => e.type === "session").length, 0);

    await host.send("b");
    assert.match(systemPrompt(cwd, id), /You are v2\./);
    assert.deepEqual(
      host.snapshot().history.filter((h) => h.role === "user").map((h) => (h as { text: string }).text),
      ["a", "b"],
    );

    await host.reset();
    await host.send("c");
    assert.equal(lastResult(events), "2 entries");
  } finally {
    await host.close();
  }
});

test("a broken tool keeps the previous version until it is fixed", async () => {
  const cwd = makeProject();
  const { host, events } = await openWatching(cwd, ["--quiet"]);
  try {
    let from = events.length;
    writeFileSync(path.join(cwd, "tools/list-files.ts"), "export default {");
    await waitFor(events, notice(/^\[tah\] reload failed — still using the previous version: .*tools\/list-files\.ts/), from);
    await host.send("a");
    assert.equal(lastResult(events), "1 entries");

    from = events.length;
    writeFileSync(path.join(cwd, "tools/list-files.ts"), listTool(3));
    await waitFor(events, notice(/^\[tah\] reloaded:/), from);
    await host.reset();
    await host.send("b");
    assert.equal(lastResult(events), "3 entries");
  } finally {
    await host.close();
  }
});

test("a plugin whose setup throws rolls back to the previous version", async () => {
  const cwd = makeProject();
  const { host, events } = await openWatching(cwd, ["--quiet"]);
  try {
    const from = events.length;
    mkdirSync(path.join(cwd, "plugins"));
    writeFileSync(path.join(cwd, "plugins/bad.ts"), `export default { setup() { throw new Error("bad setup"); } };`);
    await waitFor(events, notice(/^\[tah\] reload failed — still using the previous version: bad setup/), from);
    await host.send("a");
    assert.equal(lastResult(events), "1 entries");
  } finally {
    await host.close();
  }
});

test("a change during a turn waits for the turn; a message during a reload waits for the reload", async () => {
  const cwd = makeProject({
    "plugins/slow.ts": `export default { setup() {}, async dispose() { globalThis.tahDisposing = true; await globalThis.tahDisposeGate; } };`,
  });
  const { host, events } = await openWatching(cwd, ["--quiet"]);
  let releaseTool = () => {};
  let releaseDispose = () => {};
  try {
    gates.tahToolGate = new Promise((r) => (releaseTool = r));
    const turn = host.send("a");
    await waitFor(events, (e) => e.type === "tool.start");
    writeFileSync(path.join(cwd, "AGENTS.md"), "You are v2.");
    await sleep(500);
    assert.ok(!events.some(notice(/reload/)));
    releaseTool();
    await turn;
    await waitFor(events, notice(/^\[tah\] reloaded/));

    const from = events.length;
    gates.tahDisposeGate = new Promise((r) => (releaseDispose = r));
    gates.tahDisposing = false;
    writeFileSync(path.join(cwd, "AGENTS.md"), "You are v3.");
    for (let i = 0; i < 200 && !gates.tahDisposing; i++) await sleep(25);
    assert.ok(gates.tahDisposing);
    const sent = host.send("b");
    await sleep(100);
    releaseDispose();
    await sent;
    const kindsAfter = events.slice(from).map((e) => (e.type === "notice" ? e.text.split(":")[0] : e.type));
    assert.ok(kindsAfter.indexOf("[tah] reloaded") < kindsAfter.indexOf("user"));
  } finally {
    releaseTool();
    releaseDispose();
    await host.close();
    delete gates.tahToolGate;
    delete gates.tahDisposeGate;
  }
});

test("with persist off a change only says to restart; --no-watch does nothing", async () => {
  const cwd = makeProject();
  const off = await openWatching(cwd, ["--quiet", "--no-persist"]);
  try {
    writeFileSync(path.join(cwd, "AGENTS.md"), "You are v2.");
    await waitFor(off.events, notice(/^\[tah\] AGENTS\.md changed — restart to apply \(persist is off\)$/));
  } finally {
    await off.host.close();
  }

  const quiet = await openWatching(cwd, ["--quiet", "--no-watch"]);
  try {
    writeFileSync(path.join(cwd, "AGENTS.md"), "You are v3.");
    await sleep(500);
    assert.deepEqual(quiet.events.filter((e) => e.type === "notice"), []);
  } finally {
    await quiet.host.close();
  }
});

test("rememberAlways answers yes for a tool once it was always allowed", async () => {
  const asked: string[] = [];
  const ask = rememberAlways(async (call) => {
    asked.push(call.name);
    return call.name === "write_file" ? "always" : "no";
  });
  const call = (name: string) => ({ id: name, name, arguments: {} });
  assert.equal(await ask(call("write_file")), "always");
  assert.equal(await ask(call("write_file")), "yes");
  assert.equal(await ask(call("execute_command")), "no");
  assert.equal(await ask(call("execute_command")), "no");
  assert.deepEqual(asked, ["write_file", "execute_command", "execute_command"]);
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
