import type { Failure, TargetSignals } from "./schema.ts";
import type { ProductPage } from "./fetch.ts";
import { extractSignalsFromPage } from "./signals.ts";

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
  const size = Math.min(8, Math.max(1, limit));
  const results: Array<{ ok: true; value: R } | { ok: false; error: string }> = new Array(
    items.length,
  );
  let cursor = 0;

  async function pump(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index] as T;
      try {
        results[index] = { ok: true, value: await worker(item, index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => pump()));
  return results;
}

export async function extractSignalsForPages(
  pages: ProductPage[],
  opts?: { concurrency?: number; retryFailIds?: string[] },
): Promise<{ signals: TargetSignals[]; failures: Failure[] }> {
  const concurrency = Math.min(8, Math.max(1, opts?.concurrency ?? 3));
  const failSet = new Set(opts?.retryFailIds ?? []);

  const settled = await runWithConcurrency(pages, concurrency, async (page) => {
    if (failSet.has(page.id)) {
      throw new Error("injected extract failure");
    }
    return extractSignalsFromPage(page);
  });

  const signals: TargetSignals[] = [];
  const failures: Failure[] = [];
  for (const [i, entry] of settled.entries()) {
    const page = pages[i]!;
    if (!entry.ok) {
      failures.push({ id: page.id, stage: "extract", message: entry.error });
      continue;
    }
    signals.push(entry.value);
  }
  return { signals, failures };
}
