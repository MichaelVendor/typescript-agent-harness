import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { watchProject } from "../dist/watch.js";

const DEBOUNCE = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collects every batch; `settle()` waits out events from setup, then forgets them. */
function collect(cwd: string) {
  const batches: string[][] = [];
  const stop = watchProject(cwd, (files) => batches.push(files), DEBOUNCE);
  return {
    stop,
    files: () => batches.flat(),
    async settle() {
      await sleep(300);
      batches.length = 0;
    },
    async until(file: string) {
      for (let i = 0; i < 40 && !batches.flat().includes(file); i++) await sleep(50);
      return batches.flat();
    },
  };
}

function project(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-watch-"));
  writeFileSync(path.join(cwd, "AGENTS.md"), "v1");
  mkdirSync(path.join(cwd, "tools", "lib"), { recursive: true });
  writeFileSync(path.join(cwd, "tools", "a.ts"), "1");
  writeFileSync(path.join(cwd, "tools", "lib", "util.ts"), "1");
  return cwd;
}

test("AGENTS.md, tools/, helpers in tool subdirectories and lib/ are watched", async () => {
  const cwd = project();
  mkdirSync(path.join(cwd, "lib"));
  writeFileSync(path.join(cwd, "lib", "orders.ts"), "1");
  const w = collect(cwd);
  try {
    await w.settle();
    writeFileSync(path.join(cwd, "lib", "orders.ts"), "2");
    assert.ok((await w.until("lib/orders.ts")).includes("lib/orders.ts"));
    writeFileSync(path.join(cwd, "AGENTS.md"), "v2");
    assert.ok((await w.until("AGENTS.md")).includes("AGENTS.md"));
    writeFileSync(path.join(cwd, "tools", "a.ts"), "2");
    assert.ok((await w.until("tools/a.ts")).includes("tools/a.ts"));
    writeFileSync(path.join(cwd, "tools", "lib", "util.ts"), "2");
    assert.ok((await w.until("tools/lib/util.ts")).includes("tools/lib/util.ts"));
  } finally {
    w.stop();
  }
});

test("plugins/ created after startup is picked up", async () => {
  const cwd = project();
  const w = collect(cwd);
  try {
    await w.settle();
    mkdirSync(path.join(cwd, "plugins"));
    await w.until("plugins");
    await sleep(100);
    writeFileSync(path.join(cwd, "plugins", "p.ts"), "1");
    assert.ok((await w.until("plugins/p.ts")).includes("plugins/p.ts"));
  } finally {
    w.stop();
  }
});

test("other files in the project are ignored; stop() ends watching", async () => {
  const cwd = project();
  mkdirSync(path.join(cwd, "node_modules"));
  mkdirSync(path.join(cwd, ".tah"));
  mkdirSync(path.join(cwd, "src"));
  const w = collect(cwd);
  try {
    await w.settle();
    writeFileSync(path.join(cwd, "node_modules", "x.js"), "1");
    writeFileSync(path.join(cwd, ".tah", "cli.db"), "1");
    writeFileSync(path.join(cwd, "src", "other.ts"), "1");
    writeFileSync(path.join(cwd, "README.md"), "1");
    await sleep(400);
    assert.deepEqual(w.files(), []);
  } finally {
    w.stop();
  }
  writeFileSync(path.join(cwd, "AGENTS.md"), "v3");
  await sleep(300);
  assert.deepEqual(w.files(), []);
});
