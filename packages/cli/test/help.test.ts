import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("tah --version / -v / version print the package version", () => {
  for (const arg of ["--version", "-v", "version"]) {
    const result = spawnSync(process.execPath, [cli, arg], { encoding: "utf8" });
    assert.equal(result.status, 0, arg);
    assert.equal(result.stdout.trim(), pkg.version, arg);
  }
});

test("tah --help does not load node:sqlite", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.doesNotMatch(result.stderr, /sqlite/i);
  assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
});
