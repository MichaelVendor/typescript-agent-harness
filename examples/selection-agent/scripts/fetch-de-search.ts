/**
 * 给 data/de-search.json 里已有的商品补搜索页主图。
 * 不改标题、欧元价、评分、评论数，也不新增商品。
 * 用 curl：Node 自带的 fetch 会被德国站直接 503。
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseDeSearchHtml } from "../lib/sources/amazon-de-html.ts";

const exec = promisify(execFile);
const QUERIES = ["badezimmer tablett", "dekotablett", "seifenablage silikon", "waschbecken organizer"];
const dir = mkdtempSync(join(tmpdir(), "amz-de-"));

async function fetchQuery(query: string): Promise<string> {
  const out = join(dir, `${query.replace(/\s+/g, "-")}.html`);
  try {
    await exec("curl", [
      "-sS",
      "-L",
      "--max-time",
      "45",
      "-o",
      out,
      "-A",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "-H",
      "accept-language: de-DE,de;q=0.9",
      "-H",
      "cookie: i18n-prefs=EUR; lc-acbde=de_DE",
      `https://www.amazon.de/s?${new URLSearchParams({ k: query })}`,
    ]);
  } catch {
    // 超时也留下已下载的页面，够解析卡片就用。
  }
  return readFileSync(out, "utf8");
}

const images = new Map<string, string>();
for (const query of QUERIES) {
  const html = await fetchQuery(query);
  if (html.includes("api-services-support@amazon.com")) throw new Error(`${query}: Amazon 拒绝了这次访问`);
  const hits = parseDeSearchHtml(html).filter((hit) => hit.image && !hit.title.startsWith("Gesponserte Anzeige"));
  let added = 0;
  for (const hit of hits) {
    if (!hit.image || images.has(hit.asin)) continue;
    images.set(hit.asin, hit.image);
    added += 1;
  }
  console.log(`${query}: ${hits.length} with image, ${added} new`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
rmSync(dir, { recursive: true, force: true });

const file = fileURLToPath(new URL("../data/de-search.json", import.meta.url));
const saved = JSON.parse(readFileSync(file, "utf8")) as {
  products: { asin: string; image?: string }[];
};
let filled = 0;
for (const product of saved.products) {
  const image = images.get(product.asin);
  if (!image) continue;
  product.image = image;
  filled += 1;
}
const dossier = JSON.parse(readFileSync(fileURLToPath(new URL("../data/DE2610221.json", import.meta.url)), "utf8")) as {
  research?: { competitors?: { asin?: string; asin_image?: string }[] };
};
const byAsin: Record<string, string> = {};
for (const row of dossier.research?.competitors ?? []) {
  if (row.asin && row.asin_image?.startsWith("https://")) byAsin[row.asin] = row.asin_image;
}
for (const product of saved.products) {
  if (product.image) byAsin[product.asin] = product.image;
}
writeFileSync(file, `${JSON.stringify({ ...saved, imagesFetchedAt: new Date().toISOString() }, null, 2)}\n`);
writeFileSync(fileURLToPath(new URL("../seller-backend/images.json", import.meta.url)), `${JSON.stringify(byAsin, null, 2)}\n`);
console.log(`filled ${filled} / ${saved.products.length}; images ${Object.keys(byAsin).length}`);
