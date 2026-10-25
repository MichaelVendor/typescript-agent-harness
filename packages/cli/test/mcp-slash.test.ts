import assert from "node:assert/strict";
import { test } from "node:test";
import { applySlashPrompts, listSlashPrompts } from "../src/mcp-slash.ts";

const prompt = (over: Partial<{ required: boolean; copies: number; text: string; name: string }> = {}) => ({
  name: over.name ?? "review-code",
  server: "alpha",
  required: over.required ?? false,
  copies: over.copies ?? 1,
  async load() { return over.text ?? "be brief"; },
});

test("listSlashPrompts keeps only expandible unique kebab names", () => {
  assert.deepEqual(
    listSlashPrompts(
      [
        prompt(),
        prompt({ name: "skip-me", required: true }),
        prompt({ name: "dup", copies: 2 }),
        prompt({ name: "Review" }),
        prompt({ name: "taken" }),
      ],
      new Set(["taken"]),
    ),
    [{ name: "review-code", description: "MCP prompt (alpha)" }],
  );
});

test("a legal prompt name expands and the user line is not included", async () => {
  const suffix = await applySlashPrompts("please /review-code", [prompt()], new Set());
  assert.match(suffix, /<mcp_prompt name="review-code">/);
  assert.match(suffix, /be brief/);
  assert.doesNotMatch(suffix, /please/);
});

test("skill name, required args, and duplicates do not expand", async () => {
  assert.equal(await applySlashPrompts("/review-code", [prompt()], new Set(["review-code"])), "");
  assert.equal(await applySlashPrompts("/review-code", [prompt({ required: true })], new Set()), "");
  assert.equal(await applySlashPrompts("/review-code", [prompt({ copies: 2 })], new Set()), "");
});

test("names outside the skill pattern do not expand", async () => {
  assert.equal(await applySlashPrompts("/Review", [prompt({ name: "Review" })], new Set()), "");
});
