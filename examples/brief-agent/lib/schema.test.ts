// examples/brief-agent/lib/schema.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateBrief, type Brief } from "./schema.ts";

describe("validateBrief", () => {
  it("accepts brief with null rank and no invented rank text", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "本批可继续观察",
      rows: [
        {
          id: "B0",
          title: "Tray",
          priceEur: null,
          rank: null,
          bullets: ["不锈钢"],
          reviewThemes: ["生锈"],
          changes: [],
          evidence: [
            { claim: "标题含 Edelstahl", source: "mock", detail: "B0" },
            { claim: "差评提到 Rost", source: "mock", detail: "B0" },
            { claim: "无排名数据", source: "mock", detail: "rank=null" },
          ],
        },
      ],
      gaps: ["缺价格"],
      failures: [],
      truncated: false,
      markdown: "x",
    };
    const problems = validateBrief(brief);
    assert.equal(problems.length, 0);
  });

  it("flags markdown that invents a euro price when priceEur is null", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "观察",
      rows: [
        {
          id: "B0",
          title: "Tray",
          priceEur: null,
          rank: null,
          bullets: [],
          reviewThemes: [],
          changes: [],
          evidence: [
            { claim: "a", source: "m", detail: "1" },
            { claim: "b", source: "m", detail: "2" },
            { claim: "c", source: "m", detail: "3" },
          ],
        },
      ],
      gaps: ["缺价格"],
      failures: [],
      truncated: false,
      markdown: "Tray 售价约 €19.99",
    };
    const problems = validateBrief(brief);
    assert.ok(problems.some((p) => p.path === "markdown" && /臆造欧元价/.test(p.message)));
  });

  it("flags invented € via row.id when table title is shorter than row.title", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "观察",
      rows: [
        {
          id: "GAP1",
          title: "Bambus Tablett (缺价)",
          priceEur: null,
          rank: null,
          bullets: [],
          reviewThemes: [],
          changes: [],
          evidence: [
            { claim: "a", source: "m", detail: "1" },
            { claim: "b", source: "m", detail: "2" },
            { claim: "c", source: "m", detail: "3" },
          ],
        },
      ],
      gaps: ["缺价格: GAP1"],
      failures: [],
      truncated: false,
      markdown: "| GAP1 | Bambus Tablett | €9.99 | Bambus |",
    };
    const problems = validateBrief(brief);
    assert.ok(problems.some((p) => p.path === "markdown" && /臆造欧元价/.test(p.message)));
  });

  it("flags | id | #3 | rank text when rank is null", () => {
    const brief: Brief = {
      market: "DE",
      conclusion: "观察",
      rows: [
        {
          id: "B001",
          title: "Dekotablett Holz 30cm",
          priceEur: 24.99,
          rank: null,
          bullets: [],
          reviewThemes: [],
          changes: [],
          evidence: [
            { claim: "a", source: "m", detail: "1" },
            { claim: "b", source: "m", detail: "2" },
            { claim: "c", source: "m", detail: "3" },
          ],
        },
      ],
      gaps: [],
      failures: [],
      truncated: false,
      markdown: "| B001 | #3 | €24.99 | Akazie |",
    };
    const problems = validateBrief(brief);
    assert.ok(problems.some((p) => p.path === "markdown" && /具体名次/.test(p.message)));
  });
});