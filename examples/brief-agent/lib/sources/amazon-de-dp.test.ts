import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDeDpHtml, parseDeDpReviews } from "./amazon-de-dp.ts";
import { enrichFromDp } from "./enrich-dp.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const dpOk = readFileSync(path.join(ROOT, "data/fixtures/de-dp-ok.html"), "utf8");
const reviewsOk = readFileSync(path.join(ROOT, "data/fixtures/de-reviews-ok.html"), "utf8");
const dpNoReviews = dpOk.replace(/data-hook="review"[\s\S]*?<\/div>/g, "");

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

  it("reads reviews page collapsed bodies", () => {
    const reviews = parseDeDpReviews(reviewsOk);
    assert.ok(reviews.some((r) => /Rost/i.test(r)));
    assert.ok(reviews.some((r) => /edel/i.test(r)));
  });
});

describe("enrichFromDp", () => {
  it("uses curl html when rich", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => dpOk,
      fetchReviewsHtml: async () => "",
      browserEnabled: false,
    });
    assert.ok(out.bullets.length >= 1);
    assert.ok(out.reviewSnippets.length >= 1);
  });

  it("fills reviews from product-reviews page when /dp has none", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => dpNoReviews,
      fetchReviewsHtml: async () => reviewsOk,
      browserEnabled: false,
    });
    assert.ok(out.bullets.length >= 1);
    assert.ok(out.reviewSnippets.some((r) => /Rost/i.test(r)));
  });

  it("falls back to browser reviews then scrolled /dp", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => "validateCaptcha",
      fetchReviewsHtml: async () => "validateCaptcha",
      fetchReviewsBrowserHtml: async () => "",
      fetchDpBrowserHtml: async () => dpOk,
      browserEnabled: true,
    });
    assert.ok(out.bullets.includes("Leicht zu reinigen und stapelbar"));
    assert.ok(out.reviewSnippets.length >= 1);
  });

  it("uses browser reviews page when curl reviews blocked", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => dpNoReviews,
      fetchReviewsHtml: async () => "validateCaptcha",
      fetchReviewsBrowserHtml: async () => reviewsOk,
      browserEnabled: true,
    });
    assert.ok(out.reviewSnippets.some((r) => /Rost/i.test(r)));
  });

  it("skips browser when BRIEF path disabled", async () => {
    const out = await enrichFromDp({
      asin: "B0TEST",
      fetchDpHtml: async () => "validateCaptcha",
      fetchReviewsHtml: async () => "validateCaptcha",
      fetchDpBrowserHtml: async () => dpOk,
      fetchReviewsBrowserHtml: async () => reviewsOk,
      browserEnabled: false,
    });
    assert.deepEqual(out.bullets, []);
    assert.deepEqual(out.reviewSnippets, []);
  });
});
