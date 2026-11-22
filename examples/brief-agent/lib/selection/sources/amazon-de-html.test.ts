import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDeSearchHtml } from "./amazon-de-html.ts";

const CARD = `
<div data-asin="B0GX89NY9G" data-component-type="s-search-result">
  <h2 aria-label="Badezimmer Tablett &amp; Silikon">x</h2>
  <img class="s-image" src="https://m.media-amazon.com/images/I/71UdUsCHxDL._AC_UL320_.jpg" />
  <span class="a-offscreen">10,07&nbsp;€</span>
  <span class="a-icon-alt">4,3 von 5 Sternen</span>
  <a aria-label="1.216 Bewertungen"></a>
</div>
<div data-asin="B0NOPE0001" data-component-type="s-search-result">
  <h2 aria-label="No price"></h2>
</div>
<div data-asin="B0GX89NY9G" data-component-type="s-search-result">
  <h2 aria-label="duplicate"></h2>
  <span class="a-offscreen">9,00 €</span>
</div>
`;

test("德国站搜索卡片只留有欧元价的第一条", () => {
  const hits = parseDeSearchHtml(CARD);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.asin, "B0GX89NY9G");
  assert.equal(hits[0]?.title, "Badezimmer Tablett & Silikon");
  assert.equal(hits[0]?.price, 10.07);
  assert.equal(hits[0]?.rating, 4.3);
  assert.equal(hits[0]?.reviewCount, 1216);
  assert.equal(hits[0]?.image, "https://m.media-amazon.com/images/I/71UdUsCHxDL._AC_UL320_.jpg");
});
