import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadSuggestions } from "../dist/serve/suggestions.js";

const marker = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });

function project(files: Record<string, string>, withMarker = true): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-suggest-"));
  const all = withMarker ? { "package.json": marker, ...files } : files;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return cwd;
}

test("loadSuggestions returns nothing without a project file", async () => {
  assert.deepEqual(await loadSuggestions(project({})), []);
  assert.deepEqual(await loadSuggestions(project({ "suggestions.mjs": "export default () => [{ label: 'a', send: 'a' }];\n" }, false)), []);
});

test("loadSuggestions keeps four short chips and drops a bad row", async () => {
  const cwd = project({
    "suggestions.mjs": `export default () => [
      { label: "one", send: "a", detail: "词 · 观察" },
      { label: "  two  ", send: "b" },
      { label: "", send: "c" },
      { label: "x".repeat(80), send: "d" },
      { label: "five", send: "e" },
      { label: "six", send: "f" },
    ];\n`,
  });
  const items = await loadSuggestions(cwd);
  assert.equal(items.length, 4);
  assert.equal(items[0]?.send, "a");
  assert.equal(items[0]?.detail, "词 · 观察");
  assert.equal(items[1]?.label, "two");
  assert.ok((items[2]?.label.length ?? 0) <= 42);
  assert.equal(items[3]?.send, "e");
});
