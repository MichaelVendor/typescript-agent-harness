// lib/schema.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateMatchResult } from "./schema.ts";

test("rejects met/partial row without evidence", () => {
  const problems = validateMatchResult({
    rows: [{
      id: "r1", priority: "must", requirement: "TypeScript",
      status: "met", evidence: "",
    }],
    gaps: [],
  });
  assert.ok(problems.some((p) => /evidence/i.test(p)));
});

test("accepts missing with null evidence", () => {
  const problems = validateMatchResult({
    rows: [{
      id: "r1", priority: "must", requirement: "Kubernetes",
      status: "missing", evidence: null,
    }],
    gaps: ["r1 未覆盖"],
  });
  assert.equal(problems.length, 0);
});

test("rejects invalid status", () => {
  const bad = {
    rows: [{
      id: "r1", priority: "must" as const, requirement: "x",
      status: "ok" as "met", evidence: "e",
    }],
    gaps: [],
  };
  assert.ok(validateMatchResult(bad).some((p) => /status/i.test(p)));
});