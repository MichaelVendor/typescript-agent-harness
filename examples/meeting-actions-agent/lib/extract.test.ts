import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractActions } from "./extract.ts";
import { validateExtractResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/standup-zh.txt"),
  "utf8",
);

test("fixture: named owner vs null owner; no invented names", () => {
  const r = extractActions(fixture);
  assert.equal(validateExtractResult(r).length, 0);
  const login = r.rows.find((x) => /登录/.test(x.text));
  assert.ok(login);
  assert.equal(login!.owner, "李华");
  const help = r.rows.find((x) => /帮助文档/.test(x.text));
  assert.ok(help);
  assert.equal(help!.owner, null);
  assert.ok(r.gaps.some((g) => /帮助文档|负责人/.test(g)));
  assert.ok(r.rows.some((x) => x.kind === "decision" && /支付灰度/.test(x.text)));
  assert.ok(r.rows.some((x) => x.kind === "info" && /80ms/.test(x.text)));

  const nonNullOwners = r.rows.map((x) => x.owner).filter((o): o is string => o !== null);
  assert.deepEqual(nonNullOwners, ["李华"]);
});