import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isBlocked } from "./amazon-de-html.ts";
import { parseDeDpHtml, type DeDpEnrichment } from "./amazon-de-dp.ts";

const exec = promisify(execFile);
const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");

export type EnrichDpInput = {
  asin: string;
  /** 注入 curl HTML；测试用。 */
  fetchDpHtml?: (asin: string) => Promise<string>;
  /** 注入浏览器 HTML；测试用。 */
  fetchDpBrowserHtml?: (asin: string) => Promise<string>;
  /** 默认：BRIEF_BROWSER !== "0"。 */
  browserEnabled?: boolean;
};

function empty(): DeDpEnrichment {
  return { bullets: [], reviewSnippets: [] };
}

function needsBrowser(html: string, parsed: DeDpEnrichment): boolean {
  if (isBlocked(html)) return true;
  return parsed.bullets.length === 0 && parsed.reviewSnippets.length === 0;
}

async function curlDpHtml(asin: string): Promise<string> {
  const out = path.join(ROOT, "out", "pull", `dp-${asin}.html`);
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
      `https://www.amazon.de/dp/${encodeURIComponent(asin)}`,
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

/** headless：优先本机 Chrome（channel），再回退 Playwright Chromium；未装则空串。 */
export async function playwrightDpHtml(asin: string): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    try {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    try {
      const page = await browser.newPage();
      await page.goto(`https://www.amazon.de/dp/${encodeURIComponent(asin)}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
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

/** curl `/dp`；字段空或被挡时可选浏览器再解析。 */
export async function enrichFromDp(input: EnrichDpInput): Promise<DeDpEnrichment> {
  const getCurl = input.fetchDpHtml ?? curlDpHtml;
  let html = "";
  try {
    html = await getCurl(input.asin);
  } catch {
    html = "";
  }
  let parsed = html ? parseDeDpHtml(html) : empty();

  if (browserOn(input.browserEnabled) && needsBrowser(html, parsed)) {
    const getBrowser = input.fetchDpBrowserHtml ?? playwrightDpHtml;
    let browserHtml = "";
    try {
      browserHtml = await getBrowser(input.asin);
    } catch {
      browserHtml = "";
    }
    if (browserHtml && !isBlocked(browserHtml)) {
      const again = parseDeDpHtml(browserHtml);
      if (again.bullets.length > 0 || again.reviewSnippets.length > 0) {
        parsed = again;
      }
    }
  }

  return parsed;
}
