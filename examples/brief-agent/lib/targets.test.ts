import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTargets } from "./targets.ts";

describe("resolveTargets", () => {
  it("caps at 8 and sets truncated", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, title: `Item ${i}` }));
    const out = resolveTargets({ market: "DE", targets: raw });
    assert.equal(out.targets.length, 8);
    assert.equal(out.truncated, true);
  });

  it("assigns ids when missing", () => {
    const out = resolveTargets({ targets: [{ title: "A" }, { asin: "B000" }] });
    assert.equal(out.targets[0]?.id.startsWith("t"), true);
    assert.equal(out.targets[1]?.id, "B000");
  });
});