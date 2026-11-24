import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractResult } from "./schema.ts";

test("rejects action row without evidence", () => {
  const problems = validateExtractResult({
    rows: [{
      id: "a1", kind: "action", text: "改登录页",
      owner: null, due: null, priority: null, evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts null owner", () => {
  const problems = validateExtractResult({
    rows: [{
      id: "a1", kind: "action", text: "改登录页",
      owner: null, due: null, priority: "P1",
      evidence: "张三：我来改登录页",
    }],
    gaps: ["a1 缺负责人"],
  });
  assert.equal(problems.length, 0);
});