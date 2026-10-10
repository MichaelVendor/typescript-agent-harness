import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, initialState, type Action, type State } from "../src/state.ts";

const run = (actions: Action[], from: State = initialState) => actions.reduce(applyEvent, from);
const session = (id: string, history: Extract<Action, { type: "session" }>["history"] = []): Action => ({
  type: "session",
  id,
  resumed: false,
  history,
  hiddenTurns: 0,
});

test("startup notices survive the first session; a session switch starts a clean view", () => {
  const first = run([{ type: "notice", text: "[tah] cwd=/x" }, session("s1", [{ role: "user", text: "old" }])]);
  assert.deepEqual(
    first.entries.map((e) => e.kind),
    ["notice", "user"],
  );
  const second = run([session("s2")], first);
  assert.deepEqual(second.entries, []);
  assert.equal(second.sessionId, "s2");
});

test("a turn: user, merged text, tool lines, then turn.end", () => {
  const s = run([
    session("s1"),
    { type: "user", text: "hi" },
    { type: "text", delta: "Hel" },
    { type: "text", delta: "lo" },
    { type: "tool.start", callId: "c1", tool: "read_file", summary: "a.md" },
  ]);
  assert.equal(s.busy, true);
  assert.deepEqual(
    s.entries.map((e) => (e.kind === "assistant" ? e.text : e.kind)),
    ["user", "Hello", "tool"],
  );
  const done = run(
    [
      { type: "tool.end", callId: "c1", tool: "read_file", summary: "a.md", ok: true, result: "2 lines" },
      { type: "text", delta: "Done" },
      { type: "turn.end", state: "idle", finishReason: "stop", rounds: 2, model: "deepseek-chat" },
    ],
    s,
  );
  assert.deepEqual(done.entries[2], {
    id: 2,
    kind: "tool",
    callId: "c1",
    tool: "read_file",
    summary: "a.md",
    status: "ok",
    result: "2 lines",
  });
  assert.equal(done.entries.at(-1)?.kind, "assistant");
  assert.equal(done.busy, false);
  assert.equal(done.rounds, 2);
  assert.equal(done.model, "deepseek-chat");
});

test("a call rejected at approval never starts but still gets a failed tool line", () => {
  const s = run([
    session("s1"),
    { type: "user", text: "write it" },
    { type: "approval", id: "a1", tool: "write_file", input: { path: "x" } },
  ]);
  assert.deepEqual(s.approval, { id: "a1", tool: "write_file", input: { path: "x" } });
  const after = run(
    [
      { type: "approval.end", id: "other", answer: "no" },
      { type: "approval.end", id: "a1", answer: "no" },
      { type: "tool.end", callId: "c9", tool: "write_file", summary: "x", ok: false, result: "rejected by user" },
    ],
    s,
  );
  assert.equal(after.approval, undefined);
  assert.equal(after.entries.at(-1)?.kind, "tool");
});

test("every finished turn counts, even one whose events arrive in a single batch", () => {
  const turn = (end: Action): Action => ({ type: "batch", actions: [{ type: "user", text: "x" }, end] });
  const s = run([
    session("s1"),
    turn({ type: "turn.end", state: "idle", finishReason: "stop", rounds: 1 }),
    turn({ type: "turn.error", cancelled: false, message: "boom" }),
  ]);
  assert.equal(s.busy, false);
  assert.equal(s.turnsEnded, 2);
});

test("step limit: turn.end with max_steps prompts; continue and dismiss clear it", () => {
  const s = run([session("s1"), { type: "turn.end", state: "idle", finishReason: "max_steps", rounds: 8 }]);
  assert.equal(s.stepLimit, true);
  assert.equal(run([{ type: "local.dismiss" }], s).stepLimit, false);
  const continued = run([{ type: "local.continue" }], s);
  assert.equal(continued.stepLimit, false);
  assert.equal(continued.busy, true);
});

test("errors, cancellations and reconnects", () => {
  const s = run([
    session("s1"),
    { type: "user", text: "x" },
    { type: "turn.error", cancelled: true, message: "aborted" },
    { type: "turn.error", cancelled: false, message: "boom" },
    { type: "local.error", text: "a turn is running" },
    { type: "notice", text: "[tah] reload failed", error: true },
    { type: "notice", text: "[tah] reloaded" },
  ]);
  assert.deepEqual(
    s.entries.slice(1).map((e) => e.kind === "notice" && e.error),
    [false, true, true, true, false],
  );
  assert.equal(s.busy, false);
  assert.deepEqual(run([{ type: "local.reset" }], s), initialState);
  assert.deepEqual(run([{ type: "batch", actions: [session("s9"), { type: "user", text: "y" }] }]).entries.length, 1);
});
