import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findApiKeys } from "./env-keys.ts";

function tree(): { root: string; leaf: string; done: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), "env-keys-"));
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
  const leaf = path.join(root, "examples", "app");
  mkdirSync(leaf, { recursive: true });
  return { root, leaf, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("finds key in ancestor .env at repo root", () => {
  const t = tree();
  try {
    writeFileSync(path.join(t.root, ".env"), "# c\nDEEPSEEK_API_KEY=x\n");
    assert.deepEqual(findApiKeys(t.leaf, {}), { DEEPSEEK_API_KEY: "x" });
  } finally {
    t.done();
  }
});

test("env wins over files; nearer .env wins over farther; blank and quotes handled", () => {
  const t = tree();
  try {
    writeFileSync(path.join(t.root, ".env"), "OPENAI_API_KEY=far\nDEEPSEEK_API_KEY=far\n");
    writeFileSync(path.join(t.leaf, ".env"), 'DEEPSEEK_API_KEY="near"\nOPENAI_API_KEY=\n');
    const found = findApiKeys(t.leaf, { OPENAI_API_KEY: "envkey" });
    assert.deepEqual(found, { OPENAI_API_KEY: "envkey", DEEPSEEK_API_KEY: "near" });
  } finally {
    t.done();
  }
});

test("returns empty when no key anywhere", () => {
  const t = tree();
  try {
    writeFileSync(path.join(t.root, ".env"), "OTHER=1\n");
    assert.deepEqual(findApiKeys(t.leaf, {}), {});
  } finally {
    t.done();
  }
});

test("does not read .env above the repo root", () => {
  const t = tree();
  try {
    const inner = path.join(t.root, "sub");
    mkdirSync(path.join(inner, "a"), { recursive: true });
    writeFileSync(path.join(inner, ".git"), "");
    writeFileSync(path.join(t.root, ".env"), "DEEPSEEK_API_KEY=outside\n");
    assert.deepEqual(findApiKeys(path.join(inner, "a"), {}), {});
  } finally {
    t.done();
  }
});
