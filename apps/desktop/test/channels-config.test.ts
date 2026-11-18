import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readChannelsConfig } from "../dist/channels-config.js";

test("readChannelsConfig: missing file → none enabled, default persist", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-cfg-"));
  const cfg = readChannelsConfig(cwd);
  assert.equal(cfg.anyEnabled, false);
  assert.equal(cfg.persistDir, path.join(cwd, ".tah", "super-agent"));
});

test("readChannelsConfig: telegram enabled", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-cfg-"));
  writeFileSync(
    path.join(cwd, "tah.channels.json"),
    JSON.stringify({
      persistDir: ".tah/sa",
      channels: { telegram: { enabled: true } },
    }),
  );
  const cfg = readChannelsConfig(cwd);
  assert.equal(cfg.anyEnabled, true);
  assert.equal(cfg.enabled.telegram, true);
  assert.equal(cfg.persistDir, path.join(cwd, ".tah", "sa"));
});
