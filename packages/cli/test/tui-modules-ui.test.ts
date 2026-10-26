import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { Text } from "ink";
import { renderMarkdown } from "../dist/markdown.js";
import { App } from "../dist/tui/app.js";
import { Transcript } from "../dist/tui/transcript.js";
import { defineTuiModule, useTuiInput, type TuiCtx } from "../dist/tui/modules.js";

const host = {
  sessionId: "s1",
  approve: true,
  permissionMode: "manual" as const,
  setPermissionMode() {},
  skills: [],
  slashPrompts: [],
  on: () => () => {},
  send: async () => {},
  continueTurn: async () => {},
  cancel() {},
  answer() {},
  answerQuestion() {},
  skipQuestion() {},
  reset: async () => {},
  resume: async () => {},
  fork: async () => {},
  listSessions: async () => [],
  renameSession: async () => undefined,
  setSessionFlag: async () => {},
  reload: async () => {},
  close: async () => {},
};

test("a read-only above-input module renders above the composer", async () => {
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "cost",
      slot: "above-input",
      title: "用量",
      Component() {
        return createElement(Text, null, "本轮 3 tokens");
      },
    }),
  ];
  const app = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, cwd: "/tmp", modules } as never));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 50));
    const frame = app.lastFrame() ?? "";
    assert.match(frame, /用量/);
    assert.match(frame, /本轮 3 tokens/);
    const panelAt = frame.lastIndexOf("用量");
    const inputAt = frame.lastIndexOf(">");
    assert.ok(panelAt >= 0 && inputAt > panelAt);
  } finally {
    app.unmount();
  }
});

test("Ctrl+P focuses an interactive module and Esc returns to the composer", async () => {
  const seen: boolean[] = [];
  const sent: string[] = [];
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "ask",
      slot: "above-input",
      interactive: true,
      Component({ ctx }: { ctx: TuiCtx }) {
        seen.push(ctx.focused);
        useTuiInput(ctx, (input) => {
          if (input === "g") void ctx.send("go").then(() => undefined, () => undefined);
        });
        return createElement(Text, null, ctx.focused ? "focused" : "idle");
      },
    }),
  ];
  const app = render(
    createElement(App, {
      host: { ...host, send: async (text: string) => { sent.push(text); } },
      transcript,
      maxSteps: Infinity,
      color: false,
      modules,
    } as never),
  );
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 30));
    app.stdin.write("g");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, []);
    app.stdin.write("\x10"); // Ctrl+P
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /focused/);
    app.stdin.write("g");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, ["go"]);
    app.stdin.write("\u001b");
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /idle/);
    assert.ok(seen.includes(true));
  } finally {
    app.unmount();
  }
});

test("an untitled module that renders null shows nothing", async () => {
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "quiet",
      slot: "above-input",
      Component() {
        return null;
      },
    }),
  ];
  const withModule = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, cwd: "/tmp", modules } as never));
  const bare = render(createElement(App, { host, transcript, maxSteps: Infinity, color: false, cwd: "/tmp" } as never));
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(withModule.lastFrame(), bare.lastFrame());
  } finally {
    withModule.unmount();
    bare.unmount();
  }
});

test("a focused module gives up the keyboard while an approval card is open", async () => {
  const sent: string[] = [];
  const answers: string[] = [];
  const transcript = new Transcript(renderMarkdown);
  const modules = [
    defineTuiModule({
      id: "ask",
      slot: "above-input",
      interactive: true,
      Component({ ctx }: { ctx: TuiCtx }) {
        useTuiInput(ctx, (input) => {
          if (input === "y") void ctx.send("from-module").then(() => undefined, () => undefined);
        });
        return createElement(Text, null, ctx.focused ? "focused" : "idle");
      },
    }),
  ];
  const app = render(
    createElement(App, {
      host: {
        ...host,
        send: async (text: string) => { sent.push(text); },
        answer: (id: string, a: string) => { answers.push(`${id}:${a}`); },
      },
      transcript,
      maxSteps: Infinity,
      color: false,
      cwd: "/tmp",
      modules,
    } as never),
  );
  try {
    transcript.apply({ type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 });
    await new Promise((r) => setTimeout(r, 30));
    app.stdin.write("\x10"); // Ctrl+P
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /focused/);
    transcript.apply({ type: "approval", id: "a1", tool: "bash", input: { command: "ls" } } as never);
    await new Promise((r) => setTimeout(r, 30));
    assert.match(app.lastFrame() ?? "", /idle/);
    app.stdin.write("y");
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(sent, []);
    assert.deepEqual(answers, ["a1:yes"]);
  } finally {
    app.unmount();
  }
});
