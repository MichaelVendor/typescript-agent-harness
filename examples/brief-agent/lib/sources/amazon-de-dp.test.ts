import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDeDpHtml } from "./amazon-de-dp.ts";
import { enrichFromDp } from "./enrich-dp.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const dpOk = readFileSync(path.join(ROOT, "data/fixtures/de-dp-ok.html"), "utf8");

describe("parseDeDpHtml", () => {
  it("reads bullets and reviews from fixture", () => {
    const parsed = parseDeDpHtml(dpOk);
    assert.ok(parsed.bullets.includes("Rutschfeste Unterlage aus Silikon"));
    assert.equal(
      parsed.bullets.some((b) => /make sure this fits/i.test(b)),
      false,
    );
    assert.ok(parsed.reviewSnippets.some((r) => /schön verarbeitet/i.test(r)));
    assert.ok(parsed.reviewSnippets.some((r) => /etwas klein/i.test(r)));
  });
});

describe("enrichFromDp", () => {
  it("uses curl html when rich", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => dpOk,
      browserEnabled: false,
    });
    assert.ok(out.bullets.length >= 1);
    assert.ok(out.reviewSnippets.length >= 1);
  });

  it("falls back to browser html when curl blocked", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => "validateCaptcha",
      fetchDpBrowserHtml: async () => dpOk,
      browserEnabled: true,
    });
    assert.ok(out.bullets.includes("Leicht zu reinigen und stapelbar"));
  });

  it("skips browser when BRIEF path disabled", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => "validateCaptcha",
      fetchDpBrowserHtml: async () => dpOk,
      browserEnabled: false,
    });
    assert.deepEqual(out.bullets, []);
    assert.deepEqual(out.reviewSnippets, []);
  });
});
