import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProductHtml, parseSearchHtml } from "./amazon-html.ts";

const CARD = `
<div data-component-type="s-search-result" data-asin="B0TEST1234">
  <h2 aria-label="Steel Pet Fountain &amp; Bowl" class="a-text-normal"><span>Steel Pet Fountain</span></h2>
  <span class="a-offscreen">$24.50</span>
  <span class="a-offscreen">List Price: $30.00</span>
  <span aria-label="4.4 out of 5 stars"></span>
  <span aria-label="1,284 ratings"></span>
</div>
<div data-component-type="s-search-result" data-asin="B0TEST1234">
  <h2 aria-label="duplicate"></h2>
  <span class="a-offscreen">$10.00</span>
</div>
<div data-component-type="s-search-result" data-asin="B0NOPE9999">
  <h2 aria-label="No price here"></h2>
</div>
`;

test("parseSearchHtml keeps the current price and drops duplicates", () => {
  const hits = parseSearchHtml(CARD);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.asin, "B0TEST1234");
  assert.equal(hits[0]?.title, "Steel Pet Fountain & Bowl");
  assert.equal(hits[0]?.priceUsd, 24.5);
  assert.equal(hits[0]?.rating, 4.4);
  assert.equal(hits[0]?.reviewCount, 1284);
});

test("parseProductHtml reads rank and weight", () => {
  const html = `
    <span id="productTitle"> Fountain </span>
    <span class="a-offscreen">$22.00</span>
    Best Sellers Rank </th> <td> <span>#4,936 in Pet Supplies (</span>
    Item Weight</span></td><td><span class="a-size-base po-break-word">1.7 pounds</span>
  `;
  const facts = parseProductHtml(html, "B0TEST1234");
  assert.equal(facts.title, "Fountain");
  assert.equal(facts.priceUsd, 22);
  assert.equal(facts.bsr, 4936);
  assert.equal(facts.bsrCategory, "Pet Supplies");
  assert.equal(facts.weightLb, 1.7);
});
