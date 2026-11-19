import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSignalsFromPage } from "./signals.ts";
import { loadMockCatalog } from "./fetch.ts";
import { composeBrief } from "./compose.ts";
import { validateBrief } from "./schema.ts";

describe("composeBrief", () => {
  it("marks 缺价格 gap and passes validateBrief", () => {
    const pages = loadMockCatalog().filter((p) => ["B001", "GAP1"].includes(p.id));
    const signals = pages.map(extractSignalsFromPage);
    const brief = composeBrief({
      market: "DE",
      signals,
      failures: [],
      truncated: false,
    });
    assert.ok(brief.gaps.some((g) => /缺价格/.test(g)));
    assert.equal(validateBrief(brief).length, 0);
    // null-price Bambus row must not get a € number on its own lines
    const bambusLines = brief.markdown
      .split("\n")
      .filter((line) => line.includes("Bambus"))
      .join("\n");
    assert.equal(/€\s*\d/.test(bambusLines), false);
    assert.ok(brief.markdown.includes("### 结论"));
    assert.ok(brief.markdown.includes("### 对照表"));
    assert.ok(brief.markdown.includes("### 差评主题"));
    assert.ok(brief.markdown.includes("### 缺口"));
    assert.ok(brief.markdown.includes("缺数据"));
  });

  it("uses 本次无可用证据 when there are no rows", () => {
    const brief = composeBrief({
      market: "DE",
      signals: [],
      failures: [{ id: "X", stage: "fetch", message: "boom" }],
      truncated: false,
    });
    assert.equal(brief.conclusion, "本次无可用证据");
    assert.equal(brief.rows.length, 0);
    assert.equal(validateBrief(brief).length, 0);
  });
});
