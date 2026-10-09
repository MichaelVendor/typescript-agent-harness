import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCommands, parseCommand } from "../dist/tui/commands.js";
import {
  backspace,
  cursorColumn,
  deleteForward,
  editorText,
  emptyEditor,
  insert,
  isBlank,
  layoutEditor,
  move,
  slashQuery,
} from "../dist/tui/editor.js";

test("typing CJK moves one character at a time and the cursor counts two cells each", () => {
  let e = insert(emptyEditor(), "你好a");
  assert.equal(e.col, 3);
  assert.equal(cursorColumn(e), 5);
  e = move(e, "left");
  e = insert(e, "们");
  assert.equal(editorText(e), "你好们a");
  e = backspace(e);
  assert.equal(editorText(e), "你好a");
  assert.equal(cursorColumn(e), 4);
});

test("newlines and pasted text split lines; backspace joins them", () => {
  let e = insert(emptyEditor(), "ab");
  e = move(e, "left");
  e = insert(e, "1\r\n2\n3");
  assert.deepEqual(e.lines, ["a1", "2", "3b"]);
  assert.deepEqual([e.row, e.col], [2, 1]);
  e = move(e, "home");
  e = backspace(e);
  assert.deepEqual(e.lines, ["a1", "23b"]);
  assert.deepEqual([e.row, e.col], [1, 1]);
  e = move(e, "up");
  e = move(e, "end");
  e = deleteForward(e);
  assert.deepEqual(e.lines, ["a123b"]);
});

test("cursor moves wrap across lines and clamp to line length", () => {
  let e = insert(emptyEditor(), "long line\nab");
  e = move(e, "up");
  assert.deepEqual([e.row, e.col], [0, 2]);
  e = move(e, "end");
  e = move(e, "down");
  assert.deepEqual([e.row, e.col], [1, 2]);
  e = move(e, "home");
  e = move(e, "left");
  assert.deepEqual([e.row, e.col], [0, 9]);
  e = move(e, "right");
  assert.deepEqual([e.row, e.col], [1, 0]);
  const empty = emptyEditor();
  assert.equal(backspace(empty), empty);
  assert.equal(move(empty, "left"), empty);
});

test("layout hard-wraps by cell width and places the cursor in the wrapped rows", () => {
  const abc = insert(emptyEditor(), "abcdef");
  assert.deepEqual(layoutEditor(abc, 4), { rows: ["abcd", "ef"], cursor: { x: 2, y: 1 } });
  assert.deepEqual(layoutEditor(move(move(abc, "home"), "right"), 4).cursor, { x: 1, y: 0 });

  const cjk = insert(emptyEditor(), "你好世界");
  assert.deepEqual(layoutEditor(cjk, 5), { rows: ["你好", "世界"], cursor: { x: 4, y: 1 } });

  const full = insert(emptyEditor(), "abcd\nx");
  assert.deepEqual(layoutEditor(move(full, "up"), 4), { rows: ["abcd", "x"], cursor: { x: 1, y: 0 } });
  assert.deepEqual(layoutEditor(move(move(full, "up"), "end"), 4), { rows: ["abcd", "", "x"], cursor: { x: 0, y: 1 } });
  assert.deepEqual(layoutEditor(emptyEditor(), 4), { rows: [""], cursor: { x: 0, y: 0 } });
});

test("blank input and slash queries", () => {
  assert.equal(isBlank(insert(emptyEditor(), "  \n ")), true);
  assert.equal(slashQuery(insert(emptyEditor(), "/re")), "/re");
  assert.equal(slashQuery(insert(emptyEditor(), "/resume 2")), undefined);
  assert.equal(slashQuery(insert(emptyEditor(), "/re\nx")), undefined);
  assert.equal(slashQuery(insert(emptyEditor(), "hi /re")), undefined);
});

test("slash commands: menu filter and parsing", () => {
  assert.deepEqual(matchCommands("/re").map((c) => c.name), ["/resume", "/reset"]);
  assert.deepEqual(matchCommands("/").length, 5);
  assert.deepEqual(matchCommands("/x"), []);
  assert.deepEqual(parseCommand("/resume"), { kind: "pick" });
  assert.deepEqual(parseCommand("/resume 2"), { kind: "resume", ref: "2" });
  assert.deepEqual(parseCommand("/sessions"), { kind: "pick" });
  assert.deepEqual(parseCommand("/fork"), { kind: "fork" });
  assert.deepEqual(parseCommand("/fork 3"), { kind: "fork", turns: 3 });
  assert.deepEqual(parseCommand("/fork x"), { kind: "error", message: "usage: /fork [turns]" });
  assert.deepEqual(parseCommand("/quit"), { kind: "exit" });
  assert.equal(parseCommand("/unknown"), undefined);
  assert.equal(parseCommand("hello"), undefined);
});
