import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { render as renderInk } from "ink";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { renderMarkdown } from "../dist/markdown.js";
import { App } from "../dist/tui/app.js";
import { Transcript } from "../dist/tui/transcript.js";

const host = {
  sessionId: "s1",
  approve: true,
  on: () => () => {},
  send: async () => {},
  continueTurn: async () => {},
  cancel() {},
  answer() {},
  reset: async () => {},
  resume: async () => {},
  fork: async () => {},
  listSessions: async () => [],
  renameSession: async () => undefined,
  setSessionFlag: async () => {},
  close: async () => {},
};

test("a long reply streamed in back-to-back microtasks renders without hitting React's update limit", async () => {
  const errors: unknown[] = [];
  const onError = (e: unknown) => errors.push(e);
  process.on("uncaughtException", onError);
  try {
    const transcript = new Transcript(renderMarkdown);
    const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false } as never));
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "user", text: "你好" });
    const reply =
      Array.from({ length: 40 }, (_, i) => `- **第 ${i} 条**：\`tools/\` 下一个文件 = 一个工具。\n`).join("") + "\n结束。\n";
    for (const delta of reply.match(/[\s\S]{1,6}/g) ?? []) {
      await Promise.resolve();
      transcript.apply({ type: "text", delta });
    }
    transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1 });
    await new Promise((r) => setTimeout(r, 100));
    app.unmount();
    assert.deepEqual(errors, []);
    assert.match(app.frames.join("\n"), /结束。/);
  } finally {
    process.off("uncaughtException", onError);
  }
});

test("ask_user questions are answered by number keys or typed text, one question at a time", async () => {
  const answered: unknown[] = [];
  const skippedIds: string[] = [];
  const transcript = new Transcript(renderMarkdown);
  const app = render(
    createElement(App, {
      host: {
        ...host,
        answerQuestion: (id: string, answers: string[][]) => answered.push({ id, answers }),
        skipQuestion: (id: string) => skippedIds.push(id),
      },
      transcript,
      maxSteps: Infinity,
      color: false,
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "user", text: "build it" });
    transcript.apply({
      type: "question",
      id: "q1",
      questions: [
        { question: "Which database?", options: ["Postgres", "SQLite"] },
        { question: "Also add?", options: ["tests", "docs", "CI"], multiple: true },
      ],
    });
    await settle();
    assert.match(app.lastFrame() ?? "", /Which database\? \(1\/2\)[\s\S]*1\. Postgres[\s\S]*2\. SQLite/);
    app.stdin.write("2");
    await settle();
    assert.match(app.lastFrame() ?? "", /Also add\? \(2\/2\)/);
    app.stdin.write("1");
    await settle();
    app.stdin.write("3");
    await settle();
    assert.match(app.lastFrame() ?? "", /\[x\] 1\. tests[\s\S]*\[ \] 2\. docs[\s\S]*\[x\] 3\. CI/);
    app.stdin.write("lint");
    await settle();
    app.stdin.write("\r");
    await settle();
    assert.deepEqual(answered, [{ id: "q1", answers: [["SQLite"], ["tests", "CI", "lint"]] }]);
    transcript.apply({ type: "question.end", id: "q1" });
    await settle();
    assert.doesNotMatch(app.lastFrame() ?? "", /Also add\?/);

    transcript.apply({ type: "question", id: "q2", questions: [{ question: "Skip me?", options: ["a", "b"] }] });
    await settle();
    app.stdin.write("\x1b");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(skippedIds, ["q2"]);
  } finally {
    app.unmount();
  }
});

test("Enter during a turn queues the message; ↑ on an empty editor takes the last one back", async () => {
  const sent: string[] = [];
  const removed: string[] = [];
  const transcript = new Transcript(renderMarkdown);
  const app = render(
    createElement(App, {
      host: { ...host, send: async (text: string) => void sent.push(text), removeQueued: (id: string) => void removed.push(id) },
      transcript,
      maxSteps: Infinity,
      color: false,
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "user", text: "first" });
    await settle();
    app.stdin.write("also this");
    await settle();
    app.stdin.write("\r");
    await settle();
    assert.deepEqual(sent, ["also this"]);
    transcript.apply({ type: "queue", items: [{ id: "queued_1", text: "also this", held: false }, { id: "queued_2", text: "and that", held: true }] });
    await settle();
    assert.match(app.lastFrame() ?? "", /queued {2}also this[\s\S]*paused {2}and that[\s\S]*↑ edit queued/);
    app.stdin.write("\x1b[A");
    await settle();
    assert.deepEqual(removed, ["queued_2"]);
    assert.match(app.lastFrame() ?? "", /> and that/);
  } finally {
    app.unmount();
  }
});

test("a retry shows on the spinner line and leaves nothing in the transcript", () => {
  const transcript = new Transcript(renderMarkdown);
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  transcript.apply({ type: "user", text: "hi" });
  transcript.apply({ type: "retry", text: "HTTP 503 — retry 1 in 1.0s" });
  assert.equal(transcript.snapshot.retry, "HTTP 503 — retry 1 in 1.0s");
  const items = transcript.snapshot.items.length;
  transcript.apply({ type: "text", delta: "Hello" });
  assert.equal(transcript.snapshot.retry, undefined);
  assert.equal(transcript.snapshot.items.length, items);
});

test("a notice flagged as an error shows as an error", () => {
  const transcript = new Transcript(renderMarkdown);
  transcript.apply({ type: "notice", text: "[tah] reloaded" });
  transcript.apply({ type: "notice", text: "[tah] reload failed", error: true });
  assert.deepEqual(
    transcript.snapshot.items.map((i) => i.kind),
    ["notice", "error"],
  );
});

test("the terminal cursor sits in the input box after a reply and follows typing", async () => {
  let out = "";
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        out += String(chunk);
        done();
      },
    }),
    { isTTY: true, columns: 80, rows: 24 },
  );
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const transcript = new Transcript(renderMarkdown);
  const app = renderInk(createElement(App, { host, transcript, maxSteps: Infinity, color: false } as never), {
    stdout: stdout as never,
    stdin: stdin as never,
    exitOnCtrlC: false,
    interactive: true,
    patchConsole: false,
  });
  const settle = () => new Promise((r) => setTimeout(r, 200));
  // The frame ends on the status line; the input row is two lines up.
  const cursorAt = (column: number) => new RegExp(`\\x1b\\[2A\\x1b\\[${column}G\\x1b\\[\\?25h(\\x1b\\[\\?2026l)?$`);
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "user", text: "你好" });
    for (const delta of "你好！\n\n1. **一**\n2. **二**\n\n结束。\n".match(/[\s\S]{1,3}/g) ?? []) {
      await new Promise((r) => setTimeout(r, 5));
      transcript.apply({ type: "text", delta });
    }
    transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1 });
    await settle();
    assert.match(out, cursorAt(5));
    stdin.write("ab");
    await settle();
    assert.match(out, cursorAt(7));
  } finally {
    app.unmount();
    stdin.destroy();
  }
});

test("a paste of only image paths is saved and not inserted", async () => {
  const saved: string[] = [];
  const sent: { text: string; ids?: string[] }[] = [];
  const recordingHost = {
    ...host,
    send: async (text: string, ids?: string[]) => {
      sent.push({ text, ids });
    },
  };
  const images = {
    readClipboard: async () => ({ error: "clipboard has no image" }),
    save: (_bytes: Buffer, name: string) => ({ id: "1", name }),
    copyFile: (p: string) => {
      saved.push(p);
      return { id: String(saved.length), name: p };
    },
    isImageFile: (p: string) => p.endsWith(".png"),
  };
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, { host: recordingHost, transcript, maxSteps: Infinity, color: false, images } as never),
  );
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  app.stdin.write("\x1b[200~/tmp/a.png\x1b[201~");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(saved, ["/tmp/a.png"]);
  assert.equal(sent.length, 0);
  app.stdin.write("\r");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent[0], { text: "", ids: ["1"] });
  app.unmount();
});

test("without images, a typed image path is sent as plain text with no attachment ids", async () => {
  const sent: { text: string; ids?: string[] }[] = [];
  const recordingHost = {
    ...host,
    send: async (text: string, ids?: string[]) => {
      sent.push({ text, ids });
    },
  };
  const transcript = new Transcript((s) => s);
  const app = render(createElement(App, { host: recordingHost, transcript, maxSteps: Infinity, color: false } as never));
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  app.stdin.write("/tmp/a.png");
  await new Promise((r) => setTimeout(r, 30));
  app.stdin.write("\r");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent[0]?.text, "/tmp/a.png");
  assert.equal(sent[0]?.ids, undefined);
  app.unmount();
});

test("Alt+V attaches the clipboard image, an empty Backspace removes it, and errors show above the input", async () => {
  const sent: { text: string; ids?: string[] }[] = [];
  const recordingHost = {
    ...host,
    send: async (text: string, ids?: string[]) => {
      sent.push({ text, ids });
    },
  };
  let clip: { bytes?: Buffer; error?: string } = { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
  const images = {
    readClipboard: async () => clip,
    save: (_bytes: Buffer, name: string) => ({ id: "7", name }),
    copyFile: () => ({ error: "unused" }),
    isImageFile: () => false,
  };
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, { host: recordingHost, transcript, maxSteps: Infinity, color: false, images } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 40));
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  app.stdin.write("\x1bv");
  await settle();
  assert.match(app.lastFrame() ?? "", /clipboard\.png/);
  app.stdin.write("\x7f");
  await settle();
  assert.doesNotMatch(app.lastFrame() ?? "", /clipboard\.png/);
  clip = { error: "clipboard has no image" };
  app.stdin.write("\x1bv");
  await settle();
  assert.match(app.lastFrame() ?? "", /clipboard has no image/);
  app.stdin.write("\r");
  await settle();
  assert.equal(sent.length, 0);
  app.unmount();
});

test("a rejected send puts the pending images back, ahead of images added meanwhile", async () => {
  let reject: (e: Error) => void = () => {};
  const failingHost = {
    ...host,
    send: () => new Promise<void>((_, rej) => (reject = rej)),
  };
  let n = 0;
  const images = {
    readClipboard: async () => ({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }),
    save: (_bytes: Buffer, name: string) => ({ id: String(++n), name: `${n}-${name}` }),
    copyFile: () => ({ error: "unused" }),
    isImageFile: () => false,
  };
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, { host: failingHost, transcript, maxSteps: Infinity, color: false, images } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 40));
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  app.stdin.write("\x1bv");
  await settle();
  app.stdin.write("\r");
  await settle();
  assert.doesNotMatch(app.lastFrame() ?? "", /1-clipboard\.png/);
  app.stdin.write("\x1bv");
  await settle();
  reject(new Error("boom"));
  await settle();
  assert.match(app.lastFrame() ?? "", /1-clipboard\.png 2-clipboard\.png/);
  app.unmount();
});

test("an all-image paste is dropped while a question or the step-limit prompt is open", async () => {
  const copied: string[] = [];
  const images = {
    readClipboard: async () => ({ error: "clipboard has no image" }),
    save: (_bytes: Buffer, name: string) => ({ id: "1", name }),
    copyFile: (p: string) => {
      copied.push(p);
      return { id: "1", name: p };
    },
    isImageFile: (p: string) => p.endsWith(".png"),
  };
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, {
      host: { ...host, answerQuestion() {}, skipQuestion() {} },
      transcript,
      maxSteps: Infinity,
      color: false,
      images,
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 40));
  transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
  transcript.apply({ type: "user", text: "go" });
  transcript.apply({
    type: "question",
    id: "q1",
    questions: [{ question: "Which?", options: ["a", "b"] }],
  });
  await settle();
  app.stdin.write("\x1b[200~/tmp/q.png\x1b[201~");
  await settle();
  assert.deepEqual(copied, []);
  assert.doesNotMatch(app.lastFrame() ?? "", /q\.png/);
  app.stdin.write("1");
  await settle();
  transcript.apply({ type: "turn.end", state: "completed", finishReason: "max_steps", rounds: 1 });
  await settle();
  app.stdin.write("\x1b[200~/tmp/s.png\x1b[201~");
  await settle();
  assert.deepEqual(copied, []);
  assert.doesNotMatch(app.lastFrame() ?? "", /s\.png/);
  app.unmount();
});

test("a throwing clipboard save shows on the gray line and does not crash", async () => {
  const errors: unknown[] = [];
  const onError = (e: unknown) => errors.push(e);
  process.on("unhandledRejection", onError);
  process.on("uncaughtException", onError);
  try {
    const images = {
      readClipboard: async () => ({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }),
      save: () => {
        throw new Error("ENOSPC: no space left");
      },
      copyFile: () => ({ error: "unused" }),
      isImageFile: () => false,
    };
    const transcript = new Transcript((s) => s);
    const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, images } as never));
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    app.stdin.write("\x1bv");
    await new Promise((r) => setTimeout(r, 60));
    assert.match(app.lastFrame() ?? "", /ENOSPC: no space left/);
    assert.deepEqual(errors, []);
    app.unmount();
  } finally {
    process.off("unhandledRejection", onError);
    process.off("uncaughtException", onError);
  }
});

test("Ctrl+O opens the transcript and Esc or q returns without clearing the draft", async () => {
  const transcript = new Transcript((s) => s);
  const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false } as never));
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({
      type: "tool.end",
      callId: "c1",
      tool: "read_file",
      summary: "a.ts",
      ok: true,
      result: "SECRET_TOOL_BODY",
    });
    await settle();
    assert.doesNotMatch(app.lastFrame() ?? "", /SECRET_TOOL_BODY/);
    app.stdin.write("keepme");
    await settle();
    app.stdin.write("\x0f");
    await settle();
    assert.match(app.lastFrame() ?? "", /SECRET_TOOL_BODY/);
    assert.match(app.lastFrame() ?? "", /transcript · Esc\/q back/);
    app.stdin.write("\x1b");
    await settle();
    assert.match(app.lastFrame() ?? "", /> keepme/);
    assert.doesNotMatch(app.lastFrame() ?? "", /SECRET_TOOL_BODY/);
    assert.match(app.lastFrame() ?? "", /Enter send/);
    app.stdin.write("\x0f");
    await settle();
    app.stdin.write("q");
    await settle();
    assert.match(app.lastFrame() ?? "", /> keepme/);
    assert.doesNotMatch(app.lastFrame() ?? "", /transcript · Esc/);
  } finally {
    app.unmount();
  }
});

test("Ctrl+R filters prompt history and Enter fills the editor", async () => {
  const sent: string[] = [];
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, {
      host: { ...host, send: async (text: string) => void sent.push(text) },
      transcript,
      maxSteps: Infinity,
      color: false,
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await settle();
    app.stdin.write("alpha beta");
    await settle();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("other thing");
    await settle();
    app.stdin.write("\r");
    await settle();
    assert.deepEqual(sent, ["alpha beta", "other thing"]);
    app.stdin.write("zzz");
    await settle();
    app.stdin.write("\x12");
    await settle();
    assert.match(app.lastFrame() ?? "", /bck-i-search:/);
    assert.match(app.lastFrame() ?? "", /other thing/);
    app.stdin.write("alp");
    await settle();
    assert.match(app.lastFrame() ?? "", /bck-i-search: alp/);
    assert.match(app.lastFrame() ?? "", /alpha beta/);
    assert.doesNotMatch(app.lastFrame() ?? "", /other thing/);
    app.stdin.write("\r");
    await settle();
    assert.match(app.lastFrame() ?? "", /> alpha beta/);
    assert.equal(sent.length, 2);

    app.stdin.write("\x12");
    await settle();
    app.stdin.write("nope");
    await settle();
    app.stdin.write("\x1b");
    await settle();
    assert.match(app.lastFrame() ?? "", /> alpha beta/);
    assert.doesNotMatch(app.lastFrame() ?? "", /bck-i-search/);

    app.stdin.write("\x15");
    await settle();
    transcript.apply({ type: "session", id: "s2", resumed: true, history: [], hiddenTurns: 0 });
    await settle();
    app.stdin.write("\x12");
    await settle();
    assert.match(app.lastFrame() ?? "", /bck-i-search:/);
    assert.doesNotMatch(app.lastFrame() ?? "", /alpha beta/);
  } finally {
    app.unmount();
  }
});

test("Ctrl+G, Ctrl+S, Ctrl+T, ?, @file, and kill/yank keys", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-at-"));
  writeFileSync(path.join(dir, "note.txt"), "x");
  const opened: string[] = [];
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, {
      host,
      transcript,
      maxSteps: Infinity,
      color: false,
      cwd: dir,
      openEditor: async (text: string) => {
        opened.push(text);
        return text === "bad" ? { error: "editor unavailable" } : { text: `edited:${text}` };
      },
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "todos", todos: [{ content: "write tests", status: "pending" }] });
    await settle();
    assert.doesNotMatch(app.lastFrame() ?? "", /Todos/);
    app.stdin.write("\x14");
    await settle();
    assert.match(app.lastFrame() ?? "", /Todos[\s\S]*write tests/);

    app.stdin.write("?");
    await settle();
    assert.match(app.lastFrame() ?? "", /Ctrl\+G editor/);
    app.stdin.write("?");
    await settle();
    assert.doesNotMatch(app.lastFrame() ?? "", /Ctrl\+G editor/);

    app.stdin.write("stash me");
    await settle();
    app.stdin.write("\x13");
    await settle();
    assert.doesNotMatch(app.lastFrame() ?? "", /> stash me/);
    app.stdin.write("\x13");
    await settle();
    assert.match(app.lastFrame() ?? "", /> stash me/);

    app.stdin.write("\x07");
    await settle();
    assert.deepEqual(opened, ["stash me"]);
    assert.match(app.lastFrame() ?? "", /> edited:stash me/);

    app.stdin.write("\x15");
    await settle();
    app.stdin.write("bad");
    await settle();
    app.stdin.write("\x07");
    await settle();
    assert.match(app.lastFrame() ?? "", /editor unavailable/);
    assert.match(app.lastFrame() ?? "", /> bad/);

    app.stdin.write("\x15");
    await settle();
    app.stdin.write("ab cd");
    await settle();
    app.stdin.write("\x17");
    await settle();
    assert.match(app.lastFrame() ?? "", /> ab/);
    assert.doesNotMatch(app.lastFrame() ?? "", /cd/);
    app.stdin.write("\x19");
    await settle();
    assert.match(app.lastFrame() ?? "", /> ab cd/);
    app.stdin.write("\x1bb");
    await settle();
    app.stdin.write("\x0b");
    await settle();
    assert.match(app.lastFrame() ?? "", /> ab /);
    assert.doesNotMatch(app.lastFrame() ?? "", /cd/);

    app.stdin.write("\x15");
    await settle();
    app.stdin.write("@note");
    await settle();
    assert.match(app.lastFrame() ?? "", /note\.txt/);
    app.stdin.write("\t");
    await settle();
    assert.match(app.lastFrame() ?? "", /> note\.txt /);
    assert.doesNotMatch(app.lastFrame() ?? "", /@note/);

    app.stdin.write("\x15");
    await settle();
    app.stdin.write("stay");
    await settle();
    app.stdin.write("\x0c");
    await settle();
    assert.match(app.lastFrame() ?? "", /> stay/);
  } finally {
    app.unmount();
  }
});

test("while a turn is running, @ Enter inserts a path and the next Enter queues it; slash menu stays closed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-at-busy-"));
  writeFileSync(path.join(dir, "note.txt"), "x");
  const sent: string[] = [];
  const transcript = new Transcript((s) => s);
  const app = render(
    createElement(App, {
      host: { ...host, send: async (text: string) => void sent.push(text) },
      transcript,
      maxSteps: Infinity,
      color: false,
      cwd: dir,
    } as never),
  );
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.apply({ type: "user", text: "running" });
    await settle();
    app.stdin.write("/");
    await settle();
    assert.match(app.lastFrame() ?? "", /> \//);
    assert.doesNotMatch(app.lastFrame() ?? "", /start a new session/);
    transcript.apply({ type: "turn.end", state: "completed", finishReason: "stop", rounds: 1 });
    await settle();
    assert.match(app.lastFrame() ?? "", /start a new session/);
    app.stdin.write("\x1b");
    await settle();
    transcript.apply({ type: "user", text: "running again" });
    await settle();
    app.stdin.write("@note");
    await settle();
    assert.match(app.lastFrame() ?? "", /note\.txt/);
    app.stdin.write("\r");
    await settle();
    assert.deepEqual(sent, []);
    assert.match(app.lastFrame() ?? "", /> note\.txt /);
    assert.doesNotMatch(app.lastFrame() ?? "", /@note/);
    app.stdin.write("\r");
    await settle();
    assert.deepEqual(sent, ["note.txt "]);
  } finally {
    app.unmount();
  }
});
