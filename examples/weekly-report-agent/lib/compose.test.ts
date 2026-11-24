import test from "node:test";
import assert from "node:assert/strict";
import { composeDraft } from "./compose.ts";

test("compose lists sections and unclassified ids", () => {
  const { markdown, unclassifiedIds } = composeDraft({
    periodHint: "11/18–11/24",
    items: [
      { id: "i1", section: "done", text: "支付灰度上线", evidence: "…" },
      { id: "i2", section: "unclassified", text: "中午吃了拉面", evidence: "…" },
    ],
    gaps: ["i2 无法归类"],
  });
  assert.deepEqual(unclassifiedIds, ["i2"]);
  assert.doesNotMatch(markdown, /## 未归类/);
  const bodyBeforeGaps = markdown.split("## 缺口")[0] ?? "";
  assert.doesNotMatch(bodyBeforeGaps, /拉面/);
  assert.match(markdown, /待选模板|ops|exec/);
  assert.match(markdown, /支付灰度/);
  assert.match(markdown, /缺口|无法归类|拉面/);
});
