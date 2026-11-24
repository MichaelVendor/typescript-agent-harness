import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePair } from "./parse.ts";
import { matchRequirements } from "./match.ts";
import { validateMatchResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/pair-zh.txt"),
  "utf8",
);

test("fixture: met/partial/missing; no invented evidence", () => {
  const m = matchRequirements(parsePair(fixture));
  assert.equal(validateMatchResult(m).length, 0);
  const ts = m.rows.find((r) => /TypeScript/.test(r.requirement));
  assert.ok(ts);
  assert.equal(ts!.status, "met");
  assert.match(ts!.evidence!, /TypeScript/);
  const k8s = m.rows.find((r) => /Kubernetes/.test(r.requirement));
  assert.ok(k8s);
  assert.equal(k8s!.status, "missing");
  assert.equal(k8s!.evidence, null);
  assert.ok(m.gaps.some((g) => /Kubernetes|未覆盖/.test(g)));
  const pay = m.rows.find((r) => /支付|分布式/.test(r.requirement));
  assert.ok(pay);
  assert.ok(pay!.status === "met" || pay!.status === "partial");
  assert.ok(pay!.evidence && /支付|灰度/.test(pay!.evidence));
  assert.ok(!m.rows.some((r) => /Docker Swarm|AWS Lambda/i.test(r.evidence ?? "")));
});
