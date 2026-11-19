import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSignalsForPages } from "./extract.ts";
import { loadMockCatalog } from "./fetch.ts";

describe("extractSignalsForPages", () => {
  it("extracts signals for all pages", async () => {
    const pages = loadMockCatalog().filter((p) => p.id === "B001" || p.id === "B002");
    const out = await extractSignalsForPages(pages);
    assert.equal(out.signals.length, 2);
    assert.equal(out.failures.length, 0);
    assert.deepEqual(
      out.signals.map((s) => s.id),
      ["B001", "B002"],
    );
    assert.ok(out.signals[0]!.buckets.pricing.evidence.length >= 1);
  });

  it("records failure for injected throw and continues others", async () => {
    const pages = loadMockCatalog().filter((p) => p.id === "B001" || p.id === "B002" || p.id === "B003");
    const out = await extractSignalsForPages(pages, { retryFailIds: ["B002"], concurrency: 2 });
    assert.equal(out.signals.length, 2);
    assert.deepEqual(
      out.signals.map((s) => s.id),
      ["B001", "B003"],
    );
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0]?.id, "B002");
    assert.equal(out.failures[0]?.stage, "extract");
  });

  it("clamps concurrency to 1..8", async () => {
    const pages = loadMockCatalog().filter((p) => p.id === "B001");
    const out = await extractSignalsForPages(pages, { concurrency: 0 });
    assert.equal(out.signals.length, 1);
    assert.equal(out.failures.length, 0);
  });
});
