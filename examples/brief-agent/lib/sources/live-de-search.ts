import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Failure } from "../schema.ts";
import { isBlocked, parseDeSearchHtml, type DeSearchHit } from "./amazon-de-html.ts";
import { enrichFromDp } from "./enrich-dp.ts";
import type { FetchPagesInput, PageSource, ProductPage, SourceTarget } from "./types.ts";

const exec = promisify(execFile);
const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");

function searchQuery(target: SourceTarget): string {
  if (typeof target.query === "string" && target.query.trim()) return target.query.trim();
  if (typeof target.title === "string" && target.title.trim()) return target.title.trim();
  if (typeof target.asin === "string" && target.asin.trim()) return target.asin.trim();
  return target.id;
}

function hitToPage(target: SourceTarget, hit: DeSearchHit): ProductPage {
  return {
    id: target.id,
    title: hit.title,
    priceEur: hit.price,
    rank: null,
    bullets: [],
    reviewSnippets: [],
    changeNotes: [],
  };
}

function pickHit(target: SourceTarget, hits: DeSearchHit[]): DeSearchHit | undefined {
  if (target.asin) {
    return hits.find((h) => h.asin === target.asin);
  }
  return hits[0];
}

async function curlSearchHtml(query: string): Promise<string> {
  const out = path.join(ROOT, "out", "pull", `${query.replace(/\s+/g, "-").slice(0, 80)}.html`);
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
    // 超时留下已下载部分
  }
  try {
    return readFileSync(out, "utf8");
  } catch {
    return "";
  }
}

export const liveDeSearchSource: PageSource = {
  name: "live",
  async fetchPages(input: FetchPagesInput) {
    const pages: ProductPage[] = [];
    const failures: Failure[] = [];
    const getHtml = input.fetchHtml ?? curlSearchHtml;

    for (const target of input.targets) {
      const q = searchQuery(target);
      let html: string;
      try {
        html = await getHtml(q);
      } catch (error) {
        failures.push({
          id: target.id,
          stage: "fetch",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (isBlocked(html)) {
        failures.push({ id: target.id, stage: "fetch", message: "blocked: DE search refused or too short" });
        continue;
      }
      const hits = parseDeSearchHtml(html).filter((h) => !h.title.startsWith("Gesponserte Anzeige"));
      const hit = pickHit(target, hits);
      if (!hit) {
        failures.push({
          id: target.id,
          stage: "fetch",
          message: target.asin ? `asin ${target.asin} not in search hits` : "no search hits",
        });
        continue;
      }
      const page = hitToPage(target, hit);
      const asin = target.asin?.trim() || hit.asin;
      if (asin) {
        const enriched = await enrichFromDp({
          asin,
          ...(input.fetchDpHtml ? { fetchDpHtml: input.fetchDpHtml } : {}),
          ...(input.fetchDpBrowserHtml ? { fetchDpBrowserHtml: input.fetchDpBrowserHtml } : {}),
          ...(input.browserEnabled !== undefined ? { browserEnabled: input.browserEnabled } : {}),
        });
        page.bullets = enriched.bullets;
        page.reviewSnippets = enriched.reviewSnippets;
      }
      pages.push(page);
    }
    return { pages, failures };
  },
};
