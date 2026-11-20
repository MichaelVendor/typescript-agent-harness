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
      skipDiff: true,
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
    assert.ok(brief.markdown.includes("### 好评要点"));
    assert.equal(brief.markdown.includes("guter Preis"), true);
    const consBlock = brief.markdown.split("### 好评要点")[0]!;
    assert.equal(consBlock.includes("guter Preis"), false);
    assert.ok(brief.markdown.includes("### 缺口"));
    assert.ok(brief.markdown.includes("缺数据"));
  });

  it("uses 本次无可用证据 when there are no rows", () => {
    const brief = composeBrief({
      market: "DE",
      signals: [],
      failures: [{ id: "X", stage: "fetch", message: "boom" }],
      truncated: false,
      skipDiff: true,
    });
    assert.equal(brief.conclusion, "本次无可用证据");
    assert.equal(brief.rows.length, 0);
    assert.equal(validateBrief(brief).length, 0);
    assert.ok(brief.gaps.some((g) => g.startsWith("fetch失败:")));
  });

  it("labels gaps with failure stage (not hard-coded fetch)", () => {
    const brief = composeBrief({
      market: "DE",
      signals: [],
      failures: [{ id: "Y", stage: "extract", message: "injected" }],
      truncated: false,
      skipDiff: true,
    });
    assert.ok(brief.gaps.some((g) => g === "extract失败: Y (injected)"));
    assert.equal(brief.gaps.some((g) => g.startsWith("fetch失败:")), false);
  });

  it("exec template is one-pager without 差评主题", () => {
    const pages = loadMockCatalog().filter((p) => ["B001", "B002", "B003", "GAP1"].includes(p.id));
    const signals = pages.map(extractSignalsFromPage);
    const brief = composeBrief({
      market: "DE",
      signals,
      failures: [],
      truncated: false,
      skipDiff: true,
      template: "exec",
    });
    assert.equal(brief.template, "exec");
    assert.ok(brief.markdown.includes("### 对照"));
    assert.ok(brief.markdown.includes("### 要事"));
    assert.equal(brief.markdown.includes("### 差评主题"), false);
    assert.equal(brief.markdown.includes("### 缺口"), false);
    const tableRows = brief.markdown.split("\n").filter((l) => l.startsWith("| B") || l.startsWith("| G"));
    assert.ok(tableRows.length <= 3);
  });

  it("adds 变更 section with price arrow vs previous", () => {
    const pages = loadMockCatalog().filter((p) => p.id === "B001");
    const signals = pages.map(extractSignalsFromPage);
    const previous = composeBrief({
      market: "DE",
      signals,
      failures: [],
      truncated: false,
      skipDiff: true,
    });
    // mutate previous price for a visible diff
    previous.rows[0]!.priceEur = 99.99;
    const brief = composeBrief({
      market: "DE",
      signals,
      failures: [],
      truncated: false,
      previous,
    });
    assert.ok(brief.markdown.includes("### 变更"));
    assert.ok(brief.markdown.includes("→"));
    assert.ok(brief.changesFromPrevious?.some((l) => /价格/.test(l)));
  });
});
