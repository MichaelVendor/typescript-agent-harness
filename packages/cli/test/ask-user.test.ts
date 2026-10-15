import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Runtime } from "@typescript-agent-harness/core";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { questionsText, SKIPPED_NOTE } from "../dist/ask-user.js";
import { historyOf, questionQueue, toolResult, toolSummary, type HostEvent } from "../dist/host.js";
import { buildSystemPrompt } from "../dist/prompt.js";
import { bootRuntime } from "../dist/runtime.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "tah-ask-"));
const toolCtx = (runtime: Runtime) => ({
  sessionId: "s",
  callId: "c",
  signal: new AbortController().signal,
  runtime: runtime.context(),
});
const call = (args: unknown) => ({ id: "c", name: "ask_user", arguments: args });

test("ask_user is mounted only when a front end can answer, even with --yes, and returns the answers", async () => {
  const cwd = dir();
  const homeDir = dir();
  const flags = { ...parseArgv(["--mock", "--no-persist", "--quiet", "--yes", "chat"]), cwd };

  const none = await bootRuntime(flags, { homeDir });
  assert.equal(none.runtime.get(TOOLS).list().some((t) => t.name === "ask_user"), false);
  await none.runtime.stop();

  const asked: unknown[] = [];
  const booted = await bootRuntime(flags, {
    homeDir,
    question: async (questions) => {
      asked.push(questions);
      return [["Postgres"], ["tests", "docs"]];
    },
  });
  const tools = booted.runtime.get(TOOLS);
  try {
    const questions = [
      { question: "Which database?", options: ["Postgres", "SQLite"] },
      { question: "Also?", options: ["tests", "docs", "CI"], multiple: true },
    ];
    const ok = await tools.execute(call({ questions }), toolCtx(booted.runtime));
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.output, {
      answers: [
        { question: "Which database?", answer: ["Postgres"] },
        { question: "Also?", answer: ["tests", "docs"] },
      ],
    });
    assert.deepEqual(asked, [questions]);

    for (const bad of [
      { questions: [] },
      { questions: [{ question: "Only one?", options: ["yes"] }] },
      { questions: Array.from({ length: 5 }, () => ({ question: "q", options: ["a", "b"] })) },
      { questions: [{ question: " ", options: ["a", "b"] }] },
    ]) {
      const rejected = await tools.execute(call(bad), toolCtx(booted.runtime));
      assert.equal(rejected.ok, false, JSON.stringify(bad));
    }
    assert.equal(asked.length, 1);
  } finally {
    await booted.runtime.stop();
  }
});

test("a skipped card returns a skipped result the model can read", async () => {
  const booted = await bootRuntime(
    { ...parseArgv(["--mock", "--no-persist", "--quiet", "chat"]), cwd: dir() },
    { homeDir: dir(), question: async () => "skipped" as const },
  );
  try {
    const result = await booted.runtime
      .get(TOOLS)
      .execute(call({ questions: [{ question: "Which?", options: ["a", "b"] }] }), toolCtx(booted.runtime));
    assert.equal(result.ok, true);
    assert.deepEqual(result.output, { skipped: true, note: SKIPPED_NOTE });
  } finally {
    await booted.runtime.stop();
  }
});

test("a skipped call shows its questions as text after the tool line, also when history is rebuilt", () => {
  const questions = [
    { question: "Which database?", options: ["Postgres", "SQLite"] },
    { question: "Also?", options: ["tests", "docs"], multiple: true },
  ];
  const text = questionsText(questions);
  assert.equal(text, "**Which database?**\n- Postgres\n- SQLite\n\n**Also?** (pick any)\n- tests\n- docs");
  const { history } = historyOf([
    { role: "user", content: "build it" },
    { role: "assistant", toolCalls: [{ id: "c1", name: "ask_user", arguments: { questions } }] },
    { role: "tool", toolCallId: "c1", content: JSON.stringify({ skipped: true, note: SKIPPED_NOTE }) },
  ]);
  assert.deepEqual(
    history.map((h) => (h.role === "tool" ? `${h.tool}: ${h.result}` : `${h.role}: ${h.text}`)),
    ["user: build it", "ask_user: skipped", `assistant: ${text}`],
  );
});

test("a stopped turn settles questions with no answers, and the tool call fails", async () => {
  const cwd = dir();
  const booted = await bootRuntime(
    { ...parseArgv(["--mock", "--no-persist", "--quiet", "chat"]), cwd },
    { homeDir: dir(), question: async () => undefined },
  );
  try {
    const result = await booted.runtime
      .get(TOOLS)
      .execute(call({ questions: [{ question: "Which?", options: ["a", "b"] }] }), toolCtx(booted.runtime));
    assert.equal(result.ok, false);
  } finally {
    await booted.runtime.stop();
  }
});

test("questionQueue: an answer, an abort, a skip and rejectAll each settle once and emit question.end", async () => {
  const events: HostEvent[] = [];
  const queue = questionQueue((e) => events.push(e));
  const questions = [{ question: "Which?", options: ["a", "b"] }];

  const answered = queue.ask(questions, new AbortController().signal);
  const asked = events.at(-1) as Extract<HostEvent, { type: "question" }>;
  assert.deepEqual(asked, { type: "question", id: asked.id, questions });
  queue.answer(asked.id, [["a"]]);
  assert.deepEqual(await answered, [["a"]]);
  assert.deepEqual(events.at(-1), { type: "question.end", id: asked.id });

  const controller = new AbortController();
  const aborted = queue.ask(questions, controller.signal);
  controller.abort();
  assert.equal(await aborted, undefined);

  const skipped = queue.ask(questions, new AbortController().signal);
  queue.skip((events.at(-1) as { id: string }).id);
  assert.equal(await skipped, "skipped");

  const dropped = queue.ask(questions, new AbortController().signal);
  const droppedId = (events.at(-1) as { id: string }).id;
  queue.rejectAll();
  assert.equal(await dropped, undefined);
  queue.answer(droppedId, [["b"]]);
  assert.equal(events.filter((e) => e.type === "question.end").length, 4);
});

test("ask_user tool lines show the question and the answers; the prompt says when to ask", () => {
  const questions = [
    { question: "Which database?", options: ["a", "b"] },
    { question: "Also?", options: ["a", "b"] },
  ];
  assert.equal(toolSummary("ask_user", { questions }), "Which database? (+1)");
  assert.equal(
    toolResult("ask_user", true, { answers: [{ question: "Which database?", answer: ["Postgres"] }, { question: "Also?", answer: ["tests", "docs"] }] }),
    "Postgres · tests, docs",
  );
  assert.match(buildSystemPrompt({ exec: true, mcp: false, askUser: true }), /ask_user/);
  assert.doesNotMatch(buildSystemPrompt({ exec: true, mcp: false }), /ask_user/);
  assert.match(buildSystemPrompt({ exec: false, mcp: false, builtinTools: false, askUser: true }), /ask_user/);
});
