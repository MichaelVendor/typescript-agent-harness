import type { Failure } from "./schema.ts";
import type { TargetRef } from "./targets.ts";
import { activeSource, loadMockCatalog, type ProductPage } from "./sources/index.ts";

export type { ProductPage };
export { loadMockCatalog };

export async function fetchProductPages(input: {
  ids?: string[];
  targets?: TargetRef[];
  failIds?: string[];
  fetchHtml?: (query: string) => Promise<string>;
}): Promise<{ pages: ProductPage[]; failures: Failure[] }> {
  const targets: TargetRef[] =
    input.targets ??
    (input.ids ?? []).map((id) => ({ id }));
  const args: Parameters<ReturnType<typeof activeSource>["fetchPages"]>[0] = { targets };
  if (input.failIds !== undefined && activeSource().name === "mock") {
    args.failIds = input.failIds;
  }
  if (input.fetchHtml !== undefined) args.fetchHtml = input.fetchHtml;
  return activeSource().fetchPages(args);
}
