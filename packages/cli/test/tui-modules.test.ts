import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadTuiModules } from "../dist/tui/load-modules.js";
import { defineTuiModule, panelSend } from "../src/tui/modules.ts";

const marker = JSON.stringify({ type: "module", devDependencies: { "@typescript-agent-harness/cli": "*" } });

function project(files: Record<string, string>, withMarker = true): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-tui-mod-"));
  const all = withMarker ? { "package.json": marker, ...files } : files;
  for (const [rel, content] of Object.entries(all)) {
    const file = path.join(cwd, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return cwd;
}

const mod = (slot: string, id?: string) =>
  `export default { slot: ${JSON.stringify(slot)}, ${id ? `id: ${JSON.stringify(id)}, ` : ""}Component() { return null; } };\n`;

test("defineTuiModule returns the same object", () => {
  const Component = () => null;
  const mod = defineTuiModule({ slot: "above-input", Component });
  assert.equal(mod.slot, "above-input");
  assert.equal(mod.Component, Component);
});

test("panelSend calls through only while focused", async () => {
  const sent: string[] = [];
  const send = panelSend("cost", false, async (text) => {
    sent.push(text);
  });
  await assert.rejects(send("hi"), /tui: cost is not focused/);
  assert.deepEqual(sent, []);
  const open = panelSend("cost", true, async (text) => {
    sent.push(text);
  });
  await open("hi");
  assert.deepEqual(sent, ["hi"]);
});

test("loadTuiModules sorts mounted slots and skips the rest", async () => {
  const cwd = project({
    "tui/b-cost.mjs": mod("above-input"),
    "tui/a-footer.mjs": mod("footer"),
    "tui/c-extra.mjs": mod("above-input", "extra"),
    "tui/_skip.mjs": mod("above-input", "skip"),
    "tui/nested/nope.mjs": mod("above-input", "nope"),
  });
  const loaded = await loadTuiModules(cwd);
  assert.deepEqual(loaded.modules.map((m) => m.id), ["b-cost", "extra"]);
  assert.deepEqual(loaded.notices, [
    'tui: a-footer declares slot "footer", which this version does not mount',
  ]);
});

test("loadTuiModules rejects a bad export, a bad id, and a duplicate id", async () => {
  await assert.rejects(loadTuiModules(project({ "tui/nope.mjs": "export default {};\n" })), /tui\/nope\.mjs/);
  await assert.rejects(
    loadTuiModules(project({ "tui/Bad.mjs": mod("above-input") })),
    /invalid/,
  );
  await assert.rejects(
    loadTuiModules(project({
      "tui/one.mjs": mod("above-input", "same"),
      "tui/two.mjs": mod("above-input", "same"),
    })),
    /duplicate/,
  );
});

test("loadTuiModules returns nothing outside a project", async () => {
  const cwd = project({ "tui/cost.mjs": mod("above-input") }, false);
  assert.deepEqual(await loadTuiModules(cwd), { modules: [], notices: [] });
});
