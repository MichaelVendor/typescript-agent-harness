import assert from "node:assert/strict";
import { test } from "node:test";
import { editInEditor } from "../src/tui/external-editor.ts";

test("editInEditor returns editor unavailable when no EDITOR", async () => {
  const prev = { ...process.env };
  delete process.env.VISUAL;
  delete process.env.EDITOR;
  try {
    const r = await editInEditor("hi", { env: {} });
    assert.deepEqual(r, { error: "editor unavailable" });
  } finally {
    process.env.VISUAL = prev.VISUAL;
    process.env.EDITOR = prev.EDITOR;
  }
});

test("editInEditor returns editor failed on non-zero exit", async () => {
  const r = await editInEditor("hi", {
    env: { EDITOR: "vim" },
    mkdtemp: async () => "/tmp/tah-test",
    writeFile: async () => {},
    readFile: async () => "ignored",
    run: async () => ({ code: 1 }),
  });
  assert.deepEqual(r, { error: "editor failed" });
});

test("editInEditor returns editor failed when run throws", async () => {
  const r = await editInEditor("hi", {
    env: { EDITOR: "vim" },
    mkdtemp: async () => "/tmp/tah-test",
    writeFile: async () => {},
    readFile: async () => "ignored",
    run: async () => {
      throw new Error("spawn failed");
    },
  });
  assert.deepEqual(r, { error: "editor failed" });
});

test("editInEditor writes initial text and returns edited contents", async () => {
  let written = "";
  let runCmd = "";
  let runArgs: string[] = [];
  const r = await editInEditor("line one\n", {
    env: { VISUAL: "nano" },
    mkdtemp: async (prefix) => {
      assert.match(prefix, /tah-prompt-/);
      return "/tmp/tah-prompt-abc";
    },
    writeFile: async (path, data) => {
      assert.match(path, /tah-prompt-.*\.txt$/);
      written = data;
    },
    readFile: async (path) => {
      assert.match(path, /tah-prompt-.*\.txt$/);
      return "edited text\n";
    },
    run: async (cmd, args) => {
      runCmd = cmd;
      runArgs = args;
      assert.match(args[0] ?? "", /tah-prompt-.*\.txt$/);
      return { code: 0 };
    },
  });
  assert.equal(written, "line one\n");
  assert.equal(runCmd, "nano");
  assert.equal(runArgs.length, 1);
  assert.deepEqual(r, { text: "edited text\n" });
});

test("editInEditor prefers opts.env over process.env", async () => {
  const prevEditor = process.env.EDITOR;
  const prevVisual = process.env.VISUAL;
  process.env.EDITOR = "emacs";
  try {
    const r = await editInEditor("x", {
      env: { EDITOR: "vim" },
      mkdtemp: async () => "/d",
      writeFile: async () => {},
      readFile: async () => "ok",
      run: async (cmd) => {
        assert.equal(cmd, "vim");
        return { code: 0 };
      },
    });
    assert.deepEqual(r, { text: "ok" });
  } finally {
    if (prevEditor === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = prevEditor;
    if (prevVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = prevVisual;
  }
});
