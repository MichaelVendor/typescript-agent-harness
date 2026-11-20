import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Failure } from "../schema.ts";
import type { FetchPagesInput, PageSource, ProductPage } from "./types.ts";

const ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "../..");

type MockFile = { products: ProductPage[] };

export function loadMockCatalog(): ProductPage[] {
  const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "mock-de.json"), "utf8")) as MockFile;
  return raw.products;
}

export const mockSource: PageSource = {
  name: "mock",
  async fetchPages(input: FetchPagesInput) {
    const catalog = new Map(loadMockCatalog().map((p) => [p.id, p]));
    const failSet = new Set(input.failIds ?? []);
    const pages: ProductPage[] = [];
    const failures: Failure[] = [];
    for (const target of input.targets) {
      const id = target.id;
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
  },
};
