import test from "node:test";
import assert from "node:assert/strict";
import { confirmActions } from "./confirm.ts";

test("confirm patches owner and sets confirmed", () => {
  const batch = confirmActions(
    {
      rows: [
        {
          id: "a1",
          kind: "action",
          text: "x",
          owner: null,
          due: null,
          priority: null,
          evidence: "e",
        },
      ],
      gaps: [],
    },
    [{ id: "a1", owner: "周杰", priority: "P2" }],
  );
  assert.equal(batch.confirmed, true);
  assert.equal(batch.rows[0]!.owner, "周杰");
  assert.equal(batch.rows[0]!.priority, "P2");
});