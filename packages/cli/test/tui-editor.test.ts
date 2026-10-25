import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editorText,
  emptyEditor,
  insert,
  killLineEnd,
  killLineStart,
  killWordBack,
  move,
  moveWord,
  yank,
  type Editor,
} from "../src/tui/editor.ts";

const ed = (text: string, row = 0, col?: number): Editor => {
  const lines = text.split("\n");
  const c = col ?? (lines.at(-1)?.length ?? 0);
  return { lines, row, col: c };
};

test("killLineEnd removes from cursor to end of line", () => {
  const e = ed("hello world", 0, 5);
  const { editor, killed } = killLineEnd(e);
  assert.equal(editorText(editor), "hello");
  assert.equal(killed, " world");
  assert.deepEqual([editor.row, editor.col], [0, 5]);
});

test("killLineStart removes from line start to cursor", () => {
  const e = ed("hello world", 0, 6);
  const { editor, killed } = killLineStart(e);
  assert.equal(editorText(editor), "world");
  assert.equal(killed, "hello ");
  assert.deepEqual([editor.row, editor.col], [0, 0]);
});

test("killWordBack is whitespace-delimited", () => {
  const e = ed("one two three", 0, 13);
  const { editor, killed } = killWordBack(e);
  assert.equal(editorText(editor), "one two");
  assert.equal(killed, " three");
});

test("killWordBack from middle of word deletes that word", () => {
  const e = ed("foo bar", 0, 3);
  const { editor, killed } = killWordBack(e);
  assert.equal(editorText(editor), " bar");
  assert.equal(killed, "foo");
});

test("yank inserts at cursor", () => {
  let e = ed("hi", 0, 0);
  e = yank(e, "pre-");
  assert.equal(editorText(e), "pre-hi");
  e = move(e, "end");
  e = yank(e, "-post");
  assert.equal(editorText(e), "pre-hi-post");
});

test("moveWord skips punctuation and uses letter/digit runs", () => {
  let e = insert(emptyEditor(), "hello, world");
  e = move(e, "home");
  e = moveWord(e, "right");
  assert.equal(e.col, 5);
  e = moveWord(e, "right");
  assert.equal(e.col, 12);
  e = moveWord(e, "left");
  assert.equal(e.col, 7);
  e = moveWord(e, "left");
  assert.equal(e.col, 0);
});

test("moveWord treats CJK letters as word characters", () => {
  let e = insert(emptyEditor(), "你好 world");
  e = move(e, "home");
  e = moveWord(e, "right");
  assert.equal(e.col, 2);
  e = moveWord(e, "right");
  assert.equal(e.col, 8);
});
