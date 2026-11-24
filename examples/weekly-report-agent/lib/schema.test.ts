// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractResult } from "./schema.ts";

test("rejects item without evidence", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "done", text: "上线支付灰度", evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts unclassified with gap", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "unclassified", text: "随便记一下",
      evidence: "随便记一下",
    }],
    gaps: ["i1 无法归类"],
  });
  assert.equal(problems.length, 0);
});

test("rejects invalid section", () => {
  const problems = validateExtractResult({
    items: [{
      id: "i1", section: "done" as const, text: "x", evidence: "x",
    }],
    gaps: [],
  });
  // mutate to invalid at runtime
  const bad = {
    items: [{ id: "i1", section: "later" as "done", text: "x", evidence: "x" }],
    gaps: [],
  };
  assert.ok(validateExtractResult(bad).some((p) => /section/i.test(p)));
});