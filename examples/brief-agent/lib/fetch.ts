import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Failure } from "./schema.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

export type ProductPage = {
  id: string;
  title: string;
  priceEur: number | null;
  rank: number | null;
  bullets: string[];
  reviewSnippets: string[];
  changeNotes: string[];
};

type MockFile = { products: ProductPage[] };

export function loadMockCatalog(): ProductPage[] {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "mock-de.json"), "utf8")) as MockFile;
  return raw.products;
}

export async function fetchProductPages(input: {
  ids: string[];
  failIds?: string[];
}): Promise<{ pages: ProductPage[]; failures: Failure[] }> {
  const catalog = new Map(loadMockCatalog().map((p) => [p.id, p]));
  const failSet = new Set(input.failIds ?? []);
  const pages: ProductPage[] = [];
  const failures: Failure[] = [];
  for (const id of input.ids) {
    if (failSet.has(id)) {
      failures.push({ id, stage: "fetch", message: "injected fetch failure" });
      continue;
    }
    const page = catalog.get(id);
    if (!page) {
      failures.push({ id, stage: "fetch", message: "not found in mock catalog" });
      continue;
    }
    pages.push(page);
  }
  return { pages, failures };
}