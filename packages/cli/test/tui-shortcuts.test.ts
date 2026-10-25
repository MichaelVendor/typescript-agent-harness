import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { matchFiles } from "../dist/serve/files.js";
import { editorText, emptyEditor, insert, type Editor } from "../dist/tui/editor.js";
import { createPromptHistory } from "../dist/tui/prompt-history.js";
import {
  applyKill,
  cycleStash,
  fileMentionQuery,
  footerHint,
  historyKeyAction,
  insertFileMention,
  latestTodos,
  replaceFileMention,
  toggleTranscript,
} from "../dist/tui/shortcuts.js";

const ed = (text: string, col?: number): Editor => {
  const lines = text.split("\n");
  const row = lines.length - 1;
  return { lines, row, col: col ?? Array.from(lines[row] ?? "").length };
};

test("toggleTranscript is exclusive with history and normal", () => {
  assert.equal(toggleTranscript("normal"), "transcript");
  assert.equal(toggleTranscript("history"), "transcript");
  assert.equal(toggleTranscript("transcript"), "normal");
});

test("fileMentionQuery reads the @query ending at the cursor", () => {
  assert.equal(fileMentionQuery("see @rea", 8), "rea");
  assert.equal(fileMentionQuery("@", 1), "");
  assert.equal(fileMentionQuery(" @src", 5), "src");
  assert.equal(fileMentionQuery("a@b", 3), undefined);
  assert.equal(fileMentionQuery("see @a@b", 8), undefined);
  assert.equal(fileMentionQuery("hello @foo bar", 10), "foo");
  assert.equal(fileMentionQuery("你好 @a", 5), "a");
});

test("@ insertion uses matchFiles and replaces the mention", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-mention-"));
  writeFileSync(path.join(dir, "readme.md"), "# hi\n");
  const query = fileMentionQuery("see @rea", 8);
  assert.equal(query, "rea");
  assert.deepEqual(matchFiles(dir, query ?? ""), ["readme.md"]);
  const replaced = replaceFileMention("see @rea", 8, "readme.md");
  assert.deepEqual(replaced, { line: "see readme.md ", col: "see readme.md ".length });
  const kept = replaceFileMention("hello @foo bar", 10, "readme.md");
  assert.equal(kept.line, "hello readme.md  bar");
  const editor = insertFileMention(ed("你好 @a"), "readme.md");
  assert.equal(editorText(editor), "你好 readme.md ");
  assert.equal(editor.col, Array.from("你好 readme.md ").length);
});

test("footer hints follow the mode", () => {
  assert.match(footerHint({ mode: "normal", busy: false, queuedRecall: true }), /^↑ edit queued · Enter send/);
  assert.match(footerHint({ mode: "normal", busy: true, queuedRecall: false }), /Enter queue/);
  assert.match(footerHint({ mode: "transcript", busy: false, queuedRecall: false }), /Esc\/q back/);
  assert.equal(footerHint({ mode: "history", busy: false, queuedRecall: false }), "↑↓ choose · Enter fill · Esc cancel");
});

test("cycleStash stores editor and images, then restores them", () => {
  const image = { id: "1", name: "a.png" };
  const stashed = cycleStash(undefined, insert(emptyEditor(), "draft"), [image]);
  assert.equal(editorText(stashed.editor), "");
  assert.deepEqual(stashed.pendingImages, []);
  assert.equal(editorText(stashed.stash?.editor ?? emptyEditor()), "draft");
  const restored = cycleStash(stashed.stash, emptyEditor(), []);
  assert.equal(editorText(restored.editor), "draft");
  assert.equal(restored.editor.col, 5);
  assert.deepEqual(restored.pendingImages, [image]);
  assert.equal(restored.stash, undefined);
  const untouched = cycleStash(undefined, emptyEditor(), []);
  assert.equal(untouched.stash, undefined);
});

test("latestTodos is the last todos item", () => {
  const items = [
    { kind: "todos", todos: [{ content: "old", status: "pending" }] },
    { kind: "user" },
    { kind: "todos", todos: [{ content: "new", status: "in_progress" }] },
  ];
  assert.deepEqual(latestTodos(items), [{ content: "new", status: "in_progress" }]);
  assert.equal(latestTodos([{ kind: "user" }]), undefined);
});

test("history keys filter, move, fill, and cancel", () => {
  const history = createPromptHistory();
  history.push("alpha beta");
  history.push("other thing");
  let query = "";
  let index = 0;
  const typed = historyKeyAction("alp", {}, query, index, history.search(query));
  assert.equal(typed.type, "query");
  if (typed.type !== "query") return;
  query = typed.query;
  const matches = history.search(query);
  assert.deepEqual(matches, ["alpha beta"]);
  const down = historyKeyAction("", { downArrow: true }, query, 0, matches);
  assert.deepEqual(down, { type: "move", index: 0 });
  const accept = historyKeyAction("", { return: true }, query, 0, matches);
  assert.deepEqual(accept, { type: "accept", text: "alpha beta" });
  assert.deepEqual(historyKeyAction("", { escape: true }, query, 0, matches), { type: "cancel" });
  const erased = historyKeyAction("", { backspace: true }, "alp", 0, matches);
  assert.deepEqual(erased, { type: "query", query: "al" });
});

test("applyKill keeps the previous yank when the kill is empty", () => {
  const empty = applyKill(ed("hi"), "end", "saved");
  assert.equal(editorText(empty.editor), "hi");
  assert.equal(empty.yank, "saved");
  const word = applyKill(ed("ab cd"), "word", "saved");
  assert.equal(editorText(word.editor), "ab");
  assert.equal(word.yank, " cd");
});
