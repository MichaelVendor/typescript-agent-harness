import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { watchProject, type WatchProjectOptions } from "../dist/watch.js";

const DEBOUNCE = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collects every batch; `settle()` waits out events from setup, then forgets them. */
function collect(cwd: string, opts?: WatchProjectOptions) {
  const batches: string[][] = [];
  const stop = watchProject(cwd, (files) => batches.push(files), DEBOUNCE, opts);
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

test("skillsOnly: a plain folder reloads for skills/, not for lib/ or AGENTS.md", async () => {
  const cwd = project();
  mkdirSync(path.join(cwd, "lib"));
  mkdirSync(path.join(cwd, "skills"));
  const w = collect(cwd, { skillsOnly: true });
  try {
    await w.settle();
    writeFileSync(path.join(cwd, "lib", "orders.ts"), "2");
    writeFileSync(path.join(cwd, "AGENTS.md"), "v2");
    writeFileSync(path.join(cwd, "tools", "a.ts"), "2");
    mkdirSync(path.join(cwd, "skills", "x"));
    writeFileSync(path.join(cwd, "skills", "x", "SKILL.md"), "---\nname: x\n---\n");
    const files = await w.until("skills/x/SKILL.md");
    assert.ok(files.includes("skills/x/SKILL.md"));
    assert.deepEqual(files.filter((f) => !f.startsWith("skills")), []);
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

test("skills/ created after startup is picked up", async () => {
  const cwd = project();
  const w = collect(cwd);
  try {
    await w.settle();
    mkdirSync(path.join(cwd, "skills"));
    await w.until("skills");
    await sleep(100);
    mkdirSync(path.join(cwd, "skills", "x"));
    writeFileSync(path.join(cwd, "skills", "x", "SKILL.md"), "---\nname: x\n---\n");
    assert.ok((await w.until("skills/x/SKILL.md")).includes("skills/x/SKILL.md"));
  } finally {
    w.stop();
  }
});

test(".agents/skills and .cursor/skills are watched; other files there are ignored", async () => {
  const cwd = project();
  mkdirSync(path.join(cwd, ".cursor"));
  writeFileSync(path.join(cwd, ".cursor", "argv.json"), "{}");
  const w = collect(cwd);
  try {
    await w.settle();
    writeFileSync(path.join(cwd, ".cursor", "argv.json"), "2");
    await sleep(400);
    assert.deepEqual(w.files(), []);

    mkdirSync(path.join(cwd, ".cursor", "skills"));
    await w.until(".cursor/skills");
    await sleep(100);
    mkdirSync(path.join(cwd, ".cursor", "skills", "x"));
    writeFileSync(path.join(cwd, ".cursor", "skills", "x", "SKILL.md"), "1");
    assert.ok((await w.until(".cursor/skills/x/SKILL.md")).includes(".cursor/skills/x/SKILL.md"));

    mkdirSync(path.join(cwd, ".agents", "skills", "y"), { recursive: true });
    await w.until(".agents/skills");
    await sleep(100);
    writeFileSync(path.join(cwd, ".agents", "skills", "y", "SKILL.md"), "1");
    assert.ok((await w.until(".agents/skills/y/SKILL.md")).includes(".agents/skills/y/SKILL.md"));
  } finally {
    w.stop();
  }
});

test("homeSkillsDir watches .tah/skills", async () => {
  const cwd = project();
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  mkdirSync(path.join(home, ".tah"));
  const w = collect(cwd, { homeSkillsDir: home });
  try {
    await w.settle();
    mkdirSync(path.join(home, ".tah", "skills"));
    await w.until(".tah/skills");
    await sleep(100);
    mkdirSync(path.join(home, ".tah", "skills", "x"));
    writeFileSync(path.join(home, ".tah", "skills", "x", "SKILL.md"), "1");
    assert.ok((await w.until(".tah/skills/x/SKILL.md")).includes(".tah/skills/x/SKILL.md"));
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
