import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractItems } from "./extract.ts";
import { validateExtractResult } from "./schema.ts";

const fixture = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/notes-zh.txt"),
  "utf8",
);

test("fixture: sections + unclassified; no invented items", () => {
  const r = extractItems(fixture);
  assert.equal(validateExtractResult(r).length, 0);
  assert.match(r.periodHint ?? "", /11\/18|11-18|本周/);
  const done = r.items.find((x) => x.section === "done" && /支付灰度/.test(x.text));
  assert.ok(done);
  assert.match(done!.evidence, /支付灰度/);
  assert.ok(r.items.some((x) => x.section === "wip" && /登录页/.test(x.text)));
  assert.ok(r.items.some((x) => x.section === "risk" && /帮助文档/.test(x.text)));
  assert.ok(r.items.some((x) => x.section === "next" && /监控看板/.test(x.text)));
  const food = r.items.find((x) => /拉面/.test(x.text));
  assert.ok(food);
  assert.equal(food!.section, "unclassified");
  assert.ok(r.gaps.some((g) => /拉面|无法归类|unclassified/i.test(g)));
  // 不得编造原文没有的产品名
  assert.ok(!r.items.some((x) => /日历|Slack|Jira/i.test(x.text)));
});
