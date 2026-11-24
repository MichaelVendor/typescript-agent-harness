import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePair } from "./parse.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/pair-zh.txt"),
  "utf8",
);

test("parsePair splits resume bullets and jd must/nice", () => {
  const p = parsePair(fixture);
  assert.ok(p.resumeBullets.some((b) => /TypeScript/.test(b)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "must" && /TypeScript/.test(r.text)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "must" && /Kubernetes/.test(r.text)));
  assert.ok(p.jdRequirements.some((r) => r.priority === "nice" && /Go/.test(r.text)));
  assert.ok(p.jdRequirements.every((r) => /^r\d+$/.test(r.id)));
});
