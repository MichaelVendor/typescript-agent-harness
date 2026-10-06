import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

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
