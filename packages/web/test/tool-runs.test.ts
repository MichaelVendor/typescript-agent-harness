import assert from "node:assert/strict";
import { test } from "node:test";
import { groupToolRuns } from "../src/tool-runs.ts";
import type { Entry } from "../src/state.ts";

const user = (id: number): Entry => ({ id, kind: "user", text: "hi" });
const assistant = (id: number): Entry => ({ id, kind: "assistant", text: "ok" });
const tool = (id: number, name: string): Entry => ({
  id,
  kind: "tool",
  callId: `c${id}`,
  tool: name,
  summary: ".",
  status: "ok",
  result: "done",
});

test("groupToolRuns folds consecutive tools", () => {
  const blocks = groupToolRuns([
    user(1),
    assistant(2),
    tool(3, "list_files"),
    tool(4, "read_file"),
    assistant(5),
    tool(6, "write_file"),
  ]);
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0]?.kind, "row");
  assert.equal(blocks[2]?.kind, "tools");
  if (blocks[2]?.kind === "tools") assert.equal(blocks[2].tools.length, 2);
  assert.equal(blocks[4]?.kind, "tools");
  if (blocks[4]?.kind === "tools") assert.equal(blocks[4].tools.length, 1);
});
