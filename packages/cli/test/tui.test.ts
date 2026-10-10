import assert from "node:assert/strict";
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
    transcript.user("你好");
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
  // The frame ends one line below the status bar; the input row is three lines up.
  const cursorAt = (column: number) => new RegExp(`\\x1b\\[3A\\x1b\\[${column}G\\x1b\\[\\?25h(\\x1b\\[\\?2026l)?$`);
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    transcript.user("你好");
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
