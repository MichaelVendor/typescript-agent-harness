import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import { startChannelHost } from "../dist/channel-host/run.js";
import { loadChannelHostConfig } from "../dist/channel-host/config.js";

test("parseArgv channel-host defaults + --mock-channel", () => {
  const flags = parseArgv(["channel-host", "--mock-channel"]);
  assert.equal(flags.command, "channel-host");
  assert.equal(flags.mockChannel, true);
  assert.equal(flags.port, 7430);
});

test("loadChannelHostConfig reads tah.channels.json", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-cfg-"));
  writeFileSync(
    path.join(cwd, "tah.channels.json"),
    JSON.stringify({
      persistDir: ".tah/sa",
      channels: { telegram: { enabled: true } },
    }),
  );
  const cfg = loadChannelHostConfig(cwd);
  assert.equal(cfg.telegram.enabled, true);
  assert.ok(cfg.persistDir.endsWith(`${path.sep}.tah${path.sep}sa`));
});

test("channel-host --mock-channel: inbound → reply outbound + panel.json", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-host-"));
  const flags = {
    ...parseArgv(["channel-host", "--mock-channel", "--mock", "--cwd", cwd]),
    cwd,
  };
  const started = await startChannelHost(flags, { mockChannel: true });
  assert.ok(started.mock);
  try {
    started.mock!.push({
      source: "mock",
      threadId: "mock:play/1",
      text: "修登录空指针",
      isNewThread: true,
      replyTo: { kind: "mock", id: "1" },
    });
    for (let i = 0; i < 80; i += 1) {
      if (started.mock!.sent.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(started.mock!.sent.length >= 1, `expected outbound, got ${started.mock!.sent.length}`);
    assert.match(started.mock!.sent.map((s) => s.text).join("\n"), /DONE|已处理|needs_human/);
    const panelPath = path.join(started.persistDir, "panel.json");
    assert.ok(existsSync(panelPath), "panel.json missing");
    const panel = JSON.parse(readFileSync(panelPath, "utf8")) as { agentId: string };
    assert.ok(panel.agentId);
  } finally {
    await started.stop();
  }
});
