import test from "node:test";
import assert from "node:assert/strict";
import { composeRewrites } from "./rewrite.ts";

test("skips missing without evidence; rewrites partial with evidence", () => {
  const { rewrites } = composeRewrites({
    rows: [
      { id: "r1", priority: "must", requirement: "Kubernetes", status: "missing", evidence: null },
      {
        id: "r2", priority: "nice", requirement: "带队经验",
        status: "partial", evidence: "带过 2 人小组做周报自动化",
      },
    ],
    gaps: ["r1 未覆盖"],
  });
  assert.ok(!rewrites.some((x) => x.reqId === "r1"));
  const r2 = rewrites.find((x) => x.reqId === "r2");
  assert.ok(r2);
  assert.equal(r2!.before, "带过 2 人小组做周报自动化");
  assert.match(r2!.after, /带|小组|周报/);
  assert.doesNotMatch(r2!.after, /Kubernetes|Go 语言/);
});

test("skips met rows", () => {
  const { rewrites } = composeRewrites({
    rows: [{ id: "r1", priority: "must", requirement: "TS", status: "met", evidence: "3 年 TypeScript" }],
    gaps: [],
  });
  assert.equal(rewrites.length, 0);
});
