import type { Failure } from "../schema.ts";
import type { TargetRef } from "../targets.ts";

export type ProductPage = {
  id: string;
  title: string;
  priceEur: number | null;
  rank: number | null;
  bullets: string[];
  reviewSnippets: string[];
  changeNotes: string[];
};

export type SourceTarget = TargetRef;

export type FetchPagesInput = {
  targets: SourceTarget[];
  failIds?: string[];
  /** Eval / 测试注入：返回该 query 的 HTML，不打外网。 */
  fetchHtml?: (query: string) => Promise<string>;
  /** 注入 `/dp` curl HTML。 */
  fetchDpHtml?: (asin: string) => Promise<string>;
  /** 注入 `/dp` 浏览器 HTML。 */
  fetchDpBrowserHtml?: (asin: string) => Promise<string>;
  /** 默认跟 BRIEF_BROWSER（≠0 为开）。 */
  browserEnabled?: boolean;
};

export type PageSource = {
  name: "mock" | "live";
  fetchPages(input: FetchPagesInput): Promise<{ pages: ProductPage[]; failures: Failure[] }>;
};
