import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isBlocked } from "./amazon-de-html.ts";
import { parseDeDpHtml, parseDeDpReviews, type DeDpEnrichment } from "./amazon-de-dp.ts";

const exec = promisify(execFile);
const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");

export type EnrichDpInput = {
  asin: string;
  /** 注入 `/dp` curl HTML。 */
  fetchDpHtml?: (asin: string) => Promise<string>;
  /** 注入 `/product-reviews` curl HTML。 */
  fetchReviewsHtml?: (asin: string) => Promise<string>;
  /** 注入浏览器 `/dp` HTML（可含滚评论后）。 */
  fetchDpBrowserHtml?: (asin: string) => Promise<string>;
  /** 注入浏览器评论页 HTML。 */
  fetchReviewsBrowserHtml?: (asin: string) => Promise<string>;
  /** 默认：BRIEF_BROWSER !== "0"。 */
  browserEnabled?: boolean;
};

function empty(): DeDpEnrichment {
  return { bullets: [], reviewSnippets: [] };
}

function mergeEnrichment(base: DeDpEnrichment, extra: DeDpEnrichment): DeDpEnrichment {
  const bullets = [...base.bullets];
  const reviewSnippets = [...base.reviewSnippets];
  const seenB = new Set(bullets.map((b) => b.toLowerCase()));
  const seenR = new Set(reviewSnippets.map((r) => r.toLowerCase()));
  for (const b of extra.bullets) {
    const k = b.toLowerCase();
    if (seenB.has(k)) continue;
    seenB.add(k);
    bullets.push(b);
  }
  for (const r of extra.reviewSnippets) {
    const k = r.toLowerCase();
    if (seenR.has(k)) continue;
    seenR.add(k);
    reviewSnippets.push(r);
    if (reviewSnippets.length >= 5) break;
  }
  return { bullets: bullets.slice(0, 8), reviewSnippets: reviewSnippets.slice(0, 5) };
}

async function curlAmazon(asin: string, kind: "dp" | "reviews"): Promise<string> {
  const url =
    kind === "dp"
      ? `https://www.amazon.de/dp/${encodeURIComponent(asin)}`
      : `https://www.amazon.de/product-reviews/${encodeURIComponent(asin)}?reviewerType=all_reviews`;
  const out = path.join(ROOT, "out", "pull", `${kind}-${asin}.html`);
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
      url,
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

async function launchChrome() {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless: true, channel: "chrome" });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

/** headless 打开 `/dp`；可选滚到评论区。 */
export async function playwrightDpHtml(
  asin: string,
  opts?: { scrollReviews?: boolean },
): Promise<string> {
  try {
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      await page.goto(`https://www.amazon.de/dp/${encodeURIComponent(asin)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      if (opts?.scrollReviews) {
        await page
          .evaluate(
            `async () => {
              const sel = '[data-hook="review"], #reviewsMedley, #customer-reviews_feature_div, #reviews-medley-footer';
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ block: "center" });
              window.scrollBy(0, 400);
              await new Promise((r) => setTimeout(r, 1200));
            }`,
          )
          .catch(() => undefined);
      }
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return "";
  }
}

/** headless 打开评论列表页。 */
export async function playwrightReviewsHtml(asin: string): Promise<string> {
  try {
    const browser = await launchChrome();
    try {
      const page = await browser.newPage();
      await page.goto(
        `https://www.amazon.de/product-reviews/${encodeURIComponent(asin)}?reviewerType=all_reviews`,
        { waitUntil: "domcontentloaded", timeout: 45000 },
      );
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return "";
  }
}

function browserOn(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return process.env.BRIEF_BROWSER !== "0";
}

/** curl `/dp` + `/product-reviews`；缺评论时浏览器升档（评论页 → 滚 `/dp`）。 */
export async function enrichFromDp(input: EnrichDpInput): Promise<DeDpEnrichment> {
  const getDp = input.fetchDpHtml ?? ((asin: string) => curlAmazon(asin, "dp"));
  const getReviews = input.fetchReviewsHtml ?? ((asin: string) => curlAmazon(asin, "reviews"));

  let dpHtml = "";
  try {
    dpHtml = await getDp(input.asin);
  } catch {
    dpHtml = "";
  }
  let parsed = dpHtml && !isBlocked(dpHtml) ? parseDeDpHtml(dpHtml) : empty();

  let reviewsHtml = "";
  try {
    reviewsHtml = await getReviews(input.asin);
  } catch {
    reviewsHtml = "";
  }
  if (reviewsHtml && !isBlocked(reviewsHtml)) {
    parsed = mergeEnrichment(parsed, {
      bullets: [],
      reviewSnippets: parseDeDpReviews(reviewsHtml),
    });
  }

  const useBrowser = browserOn(input.browserEnabled);
  if (useBrowser && parsed.bullets.length === 0) {
    const getBrowserDp = input.fetchDpBrowserHtml ?? ((a: string) => playwrightDpHtml(a));
    let browserHtml = "";
    try {
      browserHtml = await getBrowserDp(input.asin);
    } catch {
      browserHtml = "";
    }
    if (browserHtml && !isBlocked(browserHtml)) {
      parsed = mergeEnrichment(parsed, parseDeDpHtml(browserHtml));
    }
  }

  if (useBrowser && parsed.reviewSnippets.length === 0) {
    const getBrowserReviews =
      input.fetchReviewsBrowserHtml ?? ((a: string) => playwrightReviewsHtml(a));
    let browserReviews = "";
    try {
      browserReviews = await getBrowserReviews(input.asin);
    } catch {
      browserReviews = "";
    }
    if (browserReviews && !isBlocked(browserReviews)) {
      parsed = mergeEnrichment(parsed, {
        bullets: [],
        reviewSnippets: parseDeDpReviews(browserReviews),
      });
    }
  }

  if (useBrowser && parsed.reviewSnippets.length === 0) {
    const getScrollDp =
      input.fetchDpBrowserHtml ?? ((a: string) => playwrightDpHtml(a, { scrollReviews: true }));
    let scrolled = "";
    try {
      scrolled = await getScrollDp(input.asin);
    } catch {
      scrolled = "";
    }
    if (scrolled && !isBlocked(scrolled)) {
      parsed = mergeEnrichment(parsed, parseDeDpHtml(scrolled));
    }
  }

  return parsed;
}
