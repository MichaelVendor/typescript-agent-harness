import { liveDeSearchSource } from "./live-de-search.ts";
import { mockSource } from "./mock.ts";
import type { PageSource } from "./types.ts";

export type { FetchPagesInput, PageSource, ProductPage, SourceTarget } from "./types.ts";
export { loadMockCatalog } from "./mock.ts";
export { isBlocked, parseDeSearchHtml } from "./amazon-de-html.ts";

/** 仅 BRIEF_SOURCE=live 启用真源；其它一律 mock。 */
export function activeSource(): PageSource {
  return process.env.BRIEF_SOURCE === "live" ? liveDeSearchSource : mockSource;
}
