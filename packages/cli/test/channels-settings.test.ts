import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  channelsSettingsView,
  resolveChannelSecrets,
  saveChannelsSettings,
} from "../dist/channels-settings.js";
import { loadChannelHostConfig } from "../dist/channel-host/config.js";
import { readConnectorSecret } from "../dist/connectors.js";

test("saveChannelsSettings writes tah.channels.json + connector secrets", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-ui-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-ch-ui-home-"));
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const view = saveChannelsSettings(cwd, home, {
      telegram: { enabled: true, botToken: "123456:AAAsecretTOKEN", mirrorChatId: "42" },
    });
    assert.equal(view.telegram.enabled, true);
    assert.equal(view.telegram.mirrorChatId, "42");
    assert.ok(view.telegram.tokenHint?.includes("…"));
    assert.equal(view.telegram.tokenSource, "settings");
    assert.equal(view.anyEnabled, true);

    const file = JSON.parse(readFileSync(path.join(cwd, "tah.channels.json"), "utf8")) as {
      channels: { telegram: { enabled: boolean; mirrorChatId: number } };
    };
    assert.equal(file.channels.telegram.enabled, true);
    assert.equal(file.channels.telegram.mirrorChatId, 42);
    const settingsPath = path.join(home, ".tah", "settings.json");
    const settings = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, "utf8")) as { channels?: unknown })
      : {};
    assert.equal(settings.channels, undefined);
    assert.equal(readConnectorSecret(home, "channel.telegram.botToken"), "123456:AAAsecretTOKEN");

    const cfg = loadChannelHostConfig(cwd, { homeDir: home });
    assert.equal(cfg.telegram.enabled, true);
    assert.equal(cfg.telegram.token, "123456:AAAsecretTOKEN");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test("resolveChannelSecrets: env wins over connectors", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ch-env-"));
  saveChannelsSettings(home, home, { telegram: { enabled: true, botToken: "from-settings-xxxx" } });
  const prev = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "from-env-yyyyyyyy";
  try {
    assert.equal(resolveChannelSecrets(home).telegramToken, "from-env-yyyyyyyy");
    const view = channelsSettingsView(home, home);
    assert.equal(view.telegram.tokenSource, "env");
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prev;
  }
});

test("legacy settings channel secrets migrate to connectors on first read", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ch-migrate-"));
  const tahDir = path.join(home, ".tah");
  mkdirSync(tahDir, { recursive: true });
  writeFileSync(
    path.join(tahDir, "settings.json"),
    JSON.stringify({
      models: [],
      channels: {
        telegramBotToken: "legacy-telegram-token",
        slackBotToken: "legacy-slack-token",
      },
    }),
  );

  assert.equal(resolveChannelSecrets(home).telegramToken, "legacy-telegram-token");
  assert.equal(readConnectorSecret(home, "channel.slack.botToken"), "legacy-slack-token");
  const settings = JSON.parse(readFileSync(path.join(tahDir, "settings.json"), "utf8")) as {
    channels?: unknown;
  };
  assert.equal(settings.channels, undefined);
});
