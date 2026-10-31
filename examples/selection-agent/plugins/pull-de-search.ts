import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { definePlugin } from "@typescript-agent-harness/cli";
import { parseDeSearchHtml, type DeSearchHit } from "../lib/sources/amazon-de-html.ts";
import { PROJECT_ROOT } from "../lib/report.ts";

const exec = promisify(execFile);

/** 四个已保存的词，一轮只拉一个，避免连着打四次。 */
export const PULL_QUERIES = ["badezimmer tablett", "dekotablett", "seifenablage silikon", "waschbecken organizer"];

const MINUTES_MIN = 3;
const MINUTES_MAX = 15;
const DEFAULT_MINUTES = 4;

type CatalogProduct = {
  asin: string;
  title: string;
  price: number;
  rating?: number;
  reviewCount?: number;
  image?: string;
  query?: string;
};

export type PullResult = {
  ok: boolean;
  query: string;
  updated: number;
  blocked: boolean;
  note: string;
};

let cursor = 0;
let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function pullIntervalMs(): number {
  const raw = Number(process.env.SELECTION_PULL_MINUTES);
  const minutes = Number.isFinite(raw) ? Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, raw)) : DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

/** 只改已有商品的价、评分、评论数和主图。不改标题，不新增 asin。 */
export function applyHits(products: CatalogProduct[], hits: DeSearchHit[]): { updated: number; images: Record<string, string> } {
  const byAsin = new Map(hits.map((hit) => [hit.asin, hit]));
  const images: Record<string, string> = {};
  let updated = 0;
  for (const product of products) {
    const hit = byAsin.get(product.asin);
    if (!hit) continue;
    let changed = false;
    if (hit.price !== product.price) {
      product.price = hit.price;
      changed = true;
    }
    if (hit.rating !== undefined && hit.rating !== product.rating) {
      product.rating = hit.rating;
      changed = true;
    }
    if (hit.reviewCount !== undefined && hit.reviewCount !== product.reviewCount) {
      product.reviewCount = hit.reviewCount;
      changed = true;
    }
    if (hit.image && hit.image !== product.image) {
      product.image = hit.image;
      changed = true;
    }
    if (hit.image) images[product.asin] = hit.image;
    if (changed) updated += 1;
  }
  return { updated, images };
}

export function isBlocked(html: string): boolean {
  return html.includes("api-services-support@amazon.com") || html.includes("validateCaptcha") || html.length < 1000;
}

async function fetchQuery(query: string): Promise<string> {
  const out = path.join(PROJECT_ROOT, "out", "pull", `${query.replace(/\s+/g, "-")}.html`);
  mkdirSync(path.dirname(out), { recursive: true });
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
    // 超时留下已下载的部分，够解析就用，不够就当这次没拉到。
  }
  try {
    return readFileSync(out, "utf8");
  } catch {
    return "";
  }
}

function writeImages(images: Record<string, string>): void {
  if (Object.keys(images).length === 0) return;
  const file = path.join(PROJECT_ROOT, "seller-backend", "images.json");
  let current: Record<string, string> = {};
  try {
    current = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    current = {};
  }
  writeFileSync(file, `${JSON.stringify({ ...current, ...images }, null, 2)}\n`);
}

/** 拉下一个词。上一次还没结束就跳过。被拒绝时不立刻重试。 */
export async function pullNext(): Promise<PullResult> {
  const query = PULL_QUERIES[cursor % PULL_QUERIES.length]!;
  if (running) {
    return { ok: false, query, updated: 0, blocked: false, note: "上一次拉取还没结束，这次跳过。" };
  }
  running = true;
  cursor += 1;
  try {
    const html = await fetchQuery(query);
    if (isBlocked(html)) {
      return { ok: false, query, updated: 0, blocked: true, note: "德国站拒绝了这次访问。等下一轮，不要马上重试。" };
    }
    const hits = parseDeSearchHtml(html).filter((hit) => !hit.title.startsWith("Gesponserte Anzeige"));
    const file = path.join(PROJECT_ROOT, "data", "de-search.json");
    const saved = JSON.parse(readFileSync(file, "utf8")) as { products: CatalogProduct[] };
    const { updated, images } = applyHits(saved.products, hits);
    writeFileSync(file, `${JSON.stringify({ ...saved, pulledAt: new Date().toISOString(), pulledQuery: query }, null, 2)}\n`);
    writeImages(images);
    const line = JSON.stringify({ at: new Date().toISOString(), query, updated, hits: hits.length });
    mkdirSync(path.join(PROJECT_ROOT, "out"), { recursive: true });
    appendFileSync(path.join(PROJECT_ROOT, "out", "pull-log.jsonl"), `${line}\n`);
    return { ok: true, query, updated, blocked: false, note: `已对照已有商品更新 ${updated} 条。没有新增商品，标题没改。` };
  } catch (error) {
    return { ok: false, query, updated: 0, blocked: false, note: error instanceof Error ? error.message : String(error) };
  } finally {
    running = false;
  }
}

export function startPullTimer(): void {
  if (timer || process.env.SELECTION_SOURCE === "mock" || process.env.SELECTION_PULL === "off") return;
  timer = setInterval(() => {
    void pullNext();
  }, pullIntervalMs());
  timer.unref?.();
}

export function stopPullTimer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

export default definePlugin({
  setup() {
    startPullTimer();
  },
  dispose() {
    stopPullTimer();
  },
});
