import assert from "node:assert/strict";
import { test } from "node:test";
import { changeLines, fileChanges } from "../src/diff-view.ts";
import type { Entry } from "../src/state.ts";

test("fileChanges keeps successful write and edit tools with input", () => {
  const entries = [
    {
      id: 1,
      kind: "tool",
      callId: "c1",
      tool: "write_file",
      summary: "a.ts",
      status: "ok",
      result: "wrote",
      path: "a.ts",
      input: { path: "a.ts", content: "hello\n" },
    },
    {
      id: 2,
      kind: "tool",
      callId: "c2",
      tool: "edit_file",
      summary: "b.ts",
      status: "failed",
      result: "no",
      path: "b.ts",
      input: { path: "b.ts", old_string: "x", new_string: "y" },
    },
    {
      id: 3,
      kind: "tool",
      callId: "c3",
      tool: "execute_command",
      summary: "ls",
      status: "ok",
      result: "ok",
    },
  ] as Entry[];
  assert.deepEqual(fileChanges(entries), [
    { id: "c1", path: "a.ts", kind: "write", content: "hello\n" },
  ]);
});

test("changeLines formats write and edit", () => {
  assert.deepEqual(changeLines({ id: "1", path: "a.ts", kind: "write", content: "a\nb" }), [
    { type: "meta", text: "+++ a.ts (new / rewrite)" },
    { type: "add", text: "+ a" },
    { type: "add", text: "+ b" },
  ]);
  assert.deepEqual(
    changeLines({ id: "2", path: "b.ts", kind: "edit", old: "old", next: "new", replaceAll: true }),
    [
      { type: "meta", text: "--- b.ts (all)" },
      { type: "del", text: "- old" },
      { type: "add", text: "+ new" },
    ],
  );
});
