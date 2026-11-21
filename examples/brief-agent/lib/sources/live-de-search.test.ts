import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { liveDeSearchSource } from "./live-de-search.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const okHtml = readFileSync(path.join(ROOT, "data/fixtures/de-search-ok.html"), "utf8");
const blockedHtml = readFileSync(path.join(ROOT, "data/fixtures/de-search-blocked.html"), "utf8");
const dpOk = readFileSync(path.join(ROOT, "data/fixtures/de-dp-ok.html"), "utf8");

describe("liveDeSearchSource", () => {
  it("maps fixture ASIN to priced page; dp enrich can fill bullets", async () => {
    const out = await liveDeSearchSource.fetchPages({
      targets: [{ id: "t1", asin: "B0GX89NY9G" }],
      fetchHtml: async () => okHtml,
      fetchDpHtml: async () => dpOk,
      browserEnabled: false,
    });
    assert.equal(out.failures.length, 0);
    assert.equal(out.pages.length, 1);
    assert.equal(out.pages[0]?.priceEur, 10.07);
    assert.match(out.pages[0]?.title ?? "", /Badezimmer/);
    assert.ok((out.pages[0]?.bullets.length ?? 0) >= 1);
    assert.ok((out.pages[0]?.reviewSnippets.length ?? 0) >= 1);
  });

  it("keeps empty bullets when dp skipped", async () => {
    const out = await liveDeSearchSource.fetchPages({
      targets: [{ id: "t1", asin: "B0GX89NY9G" }],
      fetchHtml: async () => okHtml,
      fetchDpHtml: async () => "",
      browserEnabled: false,
    });
    assert.deepEqual(out.pages[0]?.bullets, []);
  });

  it("records blocked failures", async () => {
    const out = await liveDeSearchSource.fetchPages({
      targets: [{ id: "t1", asin: "B0GX89NY9G" }],
      fetchHtml: async () => blockedHtml,
      browserEnabled: false,
    });
    assert.equal(out.pages.length, 0);
    assert.equal(out.failures.length, 1);
    assert.match(out.failures[0]?.message ?? "", /blocked/i);
  });
});
