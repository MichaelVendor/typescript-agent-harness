import test from "node:test";
import assert from "node:assert/strict";
import { renderMatchReport } from "./render.ts";

const match = {
  rows: [
    { id: "r1", priority: "must" as const, requirement: "TS", status: "met" as const, evidence: "3 年 TypeScript" },
    { id: "r2", priority: "must" as const, requirement: "K8s", status: "missing" as const, evidence: null },
  ],
  gaps: ["r2 未覆盖"],
};

test("render includes table and optional rewrites section", () => {
  const { markdown } = renderMatchReport(match, [
    { reqId: "r2", before: "x", after: "y", evidence: "x" },
  ]);
  assert.match(markdown, /匹配表|requirement|必须|TS/i);
  assert.match(markdown, /改写|r2/);
  assert.match(markdown, /缺口|未覆盖/);
});

test("render omits rewrites section when null", () => {
  const { markdown } = renderMatchReport(match, null);
  assert.doesNotMatch(markdown, /改写建议/);
});
