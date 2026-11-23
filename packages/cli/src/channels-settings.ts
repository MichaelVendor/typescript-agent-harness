/**
 * Project IM toggles → `<cwd>/tah.channels.json`.
 * Bot secrets → `~/.tah/connectors.json`; env still wins when set.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  readConnectorSecret,
  removeConnector,
  upsertConnectorToken,
} from "./connectors.js";
import {
  keyHint,
  loadSettings,
  type ChannelSecrets,
  type Settings,
  settingsPath,
} from "./settings.js";
import { chmodSync, mkdirSync } from "node:fs";

export type ChannelsFile = {
  persistDir?: string;
  port?: number;
  channels?: {
    telegram?: { enabled?: boolean; mirrorChatId?: number | string | null };
    slack?: { enabled?: boolean };
    feishu?: { enabled?: boolean };
    dingtalk?: { enabled?: boolean };
  };
};

export type ChannelsSettingsView = {
  telegram: {
    enabled: boolean;
    tokenHint: string | null;
    tokenSource: "settings" | "env" | null;
    mirrorChatId: string;
  };
  slack: {
    enabled: boolean;
    botTokenHint: string | null;
    botTokenSource: "settings" | "env" | null;
    signingSecretHint: string | null;
    signingSecretSource: "settings" | "env" | null;
  };
  feishu: {
    enabled: boolean;
    appIdHint: string | null;
    appIdSource: "settings" | "env" | null;
    appSecretHint: string | null;
    appSecretSource: "settings" | "env" | null;
    verificationTokenHint: string | null;
    verificationTokenSource: "settings" | "env" | null;
  };
  dingtalk: {
    enabled: boolean;
    appKeyHint: string | null;
    appKeySource: "settings" | "env" | null;
    appSecretHint: string | null;
    appSecretSource: "settings" | "env" | null;
    verificationTokenHint: string | null;
    verificationTokenSource: "settings" | "env" | null;
  };
  anyEnabled: boolean;
};

export type ChannelsSettingsPatch = {
  telegram?: { enabled?: boolean; botToken?: string | null; mirrorChatId?: string | null };
  slack?: { enabled?: boolean; botToken?: string | null; signingSecret?: string | null };
  feishu?: {
    enabled?: boolean;
    appId?: string | null;
    appSecret?: string | null;
    verificationToken?: string | null;
  };
  dingtalk?: {
    enabled?: boolean;
    appKey?: string | null;
    appSecret?: string | null;
    verificationToken?: string | null;
  };
};

function channelsPath(cwd: string): string {
  return path.join(cwd, "tah.channels.json");
}

function readChannelsFile(cwd: string): ChannelsFile {
  const file = channelsPath(cwd);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ChannelsFile;
  } catch {
    return {};
  }
}

function writeChannelsFile(cwd: string, file: ChannelsFile): void {
  writeFileSync(channelsPath(cwd), `${JSON.stringify(file, null, 2)}\n`);
}

function saveHomeSettings(home: string, settings: Settings): void {
  const file = settingsPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function hintSource(
  connectorVal: string | undefined,
  envVal: string | undefined,
): { hint: string | null; source: "settings" | "env" | null } {
  if (envVal?.trim()) return { hint: keyHint(envVal.trim()), source: "env" };
  if (connectorVal?.trim()) return { hint: keyHint(connectorVal.trim()), source: "settings" };
  return { hint: null, source: null };
}

const CONNECTOR_IDS: Record<keyof ChannelSecrets, { id: string; provider: string; label: string }> = {
  telegramBotToken: { id: "channel.telegram.botToken", provider: "telegram", label: "Bot token" },
  slackBotToken: { id: "channel.slack.botToken", provider: "slack", label: "Bot token" },
  slackSigningSecret: { id: "channel.slack.signingSecret", provider: "slack", label: "Signing secret" },
  feishuAppId: { id: "channel.feishu.appId", provider: "feishu", label: "App ID" },
  feishuAppSecret: { id: "channel.feishu.appSecret", provider: "feishu", label: "App secret" },
  feishuVerificationToken: {
    id: "channel.feishu.verificationToken",
    provider: "feishu",
    label: "Verification token",
  },
  dingtalkAppKey: { id: "channel.dingtalk.appKey", provider: "dingtalk", label: "App key" },
  dingtalkAppSecret: { id: "channel.dingtalk.appSecret", provider: "dingtalk", label: "App secret" },
  dingtalkVerificationToken: {
    id: "channel.dingtalk.verificationToken",
    provider: "dingtalk",
    label: "Verification token",
  },
};

function connectorSecrets(home: string): ChannelSecrets {
  const settings = loadSettings(home);
  const legacy = settings.channels ?? {};
  const secrets: ChannelSecrets = {};
  for (const key of Object.keys(CONNECTOR_IDS) as (keyof ChannelSecrets)[]) {
    const connector = CONNECTOR_IDS[key];
    let value = readConnectorSecret(home, connector.id);
    if (!value && legacy[key]) {
      upsertConnectorToken(home, { ...connector, token: legacy[key] });
      value = legacy[key];
    }
    if (value) secrets[key] = value;
  }
  if (settings.channels) {
    const { channels: _, ...rest } = settings;
    saveHomeSettings(home, rest);
  }
  return secrets;
}

export function channelsSettingsView(cwd: string, home: string): ChannelsSettingsView {
  const file = readChannelsFile(cwd);
  const ch = file.channels ?? {};
  const secrets = connectorSecrets(home);
  const tg = hintSource(secrets.telegramBotToken, process.env.TELEGRAM_BOT_TOKEN);
  const slackBot = hintSource(secrets.slackBotToken, process.env.SLACK_BOT_TOKEN);
  const slackSign = hintSource(secrets.slackSigningSecret, process.env.SLACK_SIGNING_SECRET);
  const feishuId = hintSource(secrets.feishuAppId, process.env.FEISHU_APP_ID);
  const feishuSecret = hintSource(secrets.feishuAppSecret, process.env.FEISHU_APP_SECRET);
  const feishuTok = hintSource(secrets.feishuVerificationToken, process.env.FEISHU_VERIFICATION_TOKEN);
  const dtKey = hintSource(secrets.dingtalkAppKey, process.env.DINGTALK_APP_KEY);
  const dtSecret = hintSource(secrets.dingtalkAppSecret, process.env.DINGTALK_APP_SECRET);
  const dtTok = hintSource(secrets.dingtalkVerificationToken, process.env.DINGTALK_VERIFICATION_TOKEN);
  const mirror = ch.telegram?.mirrorChatId;
  const telegram = {
    enabled: ch.telegram?.enabled === true,
    tokenHint: tg.hint,
    tokenSource: tg.source,
    mirrorChatId: mirror === undefined || mirror === null ? "" : String(mirror),
  };
  const slack = {
    enabled: ch.slack?.enabled === true,
    botTokenHint: slackBot.hint,
    botTokenSource: slackBot.source,
    signingSecretHint: slackSign.hint,
    signingSecretSource: slackSign.source,
  };
  const feishu = {
    enabled: ch.feishu?.enabled === true,
    appIdHint: feishuId.hint,
    appIdSource: feishuId.source,
    appSecretHint: feishuSecret.hint,
    appSecretSource: feishuSecret.source,
    verificationTokenHint: feishuTok.hint,
    verificationTokenSource: feishuTok.source,
  };
  const dingtalk = {
    enabled: ch.dingtalk?.enabled === true,
    appKeyHint: dtKey.hint,
    appKeySource: dtKey.source,
    appSecretHint: dtSecret.hint,
    appSecretSource: dtSecret.source,
    verificationTokenHint: dtTok.hint,
    verificationTokenSource: dtTok.source,
  };
  return {
    telegram,
    slack,
    feishu,
    dingtalk,
    anyEnabled: telegram.enabled || slack.enabled || feishu.enabled || dingtalk.enabled,
  };
}

function applyConnectorSecret(
  home: string,
  key: keyof ChannelSecrets,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  const connector = CONNECTOR_IDS[key];
  if (value === null) {
    removeConnector(home, connector.id);
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) return;
  upsertConnectorToken(home, { ...connector, token: trimmed });
}

export function saveChannelsSettings(cwd: string, home: string, patch: ChannelsSettingsPatch): ChannelsSettingsView {
  const file = readChannelsFile(cwd);
  const channels = { ...(file.channels ?? {}) };
  connectorSecrets(home);

  if (patch.telegram) {
    const t = patch.telegram;
    const prev = { ...(channels.telegram ?? {}) };
    if (t.enabled !== undefined) prev.enabled = t.enabled;
    if (t.mirrorChatId !== undefined) {
      if (t.mirrorChatId === null || t.mirrorChatId.trim() === "") delete prev.mirrorChatId;
      else {
        const n = Number(t.mirrorChatId.trim());
        if (!Number.isFinite(n)) throw new Error("telegram.mirrorChatId must be a number");
        prev.mirrorChatId = n;
      }
    }
    channels.telegram = prev;
    applyConnectorSecret(home, "telegramBotToken", t.botToken);
  }
  if (patch.slack) {
    const s = patch.slack;
    const prev = { ...(channels.slack ?? {}) };
    if (s.enabled !== undefined) prev.enabled = s.enabled;
    channels.slack = prev;
    applyConnectorSecret(home, "slackBotToken", s.botToken);
    applyConnectorSecret(home, "slackSigningSecret", s.signingSecret);
  }
  if (patch.feishu) {
    const f = patch.feishu;
    const prev = { ...(channels.feishu ?? {}) };
    if (f.enabled !== undefined) prev.enabled = f.enabled;
    channels.feishu = prev;
    applyConnectorSecret(home, "feishuAppId", f.appId);
    applyConnectorSecret(home, "feishuAppSecret", f.appSecret);
    applyConnectorSecret(home, "feishuVerificationToken", f.verificationToken);
  }
  if (patch.dingtalk) {
    const d = patch.dingtalk;
    const prev = { ...(channels.dingtalk ?? {}) };
    if (d.enabled !== undefined) prev.enabled = d.enabled;
    channels.dingtalk = prev;
    applyConnectorSecret(home, "dingtalkAppKey", d.appKey);
    applyConnectorSecret(home, "dingtalkAppSecret", d.appSecret);
    applyConnectorSecret(home, "dingtalkVerificationToken", d.verificationToken);
  }

  writeChannelsFile(cwd, {
    persistDir: file.persistDir ?? ".tah/super-agent",
    ...(file.port !== undefined ? { port: file.port } : {}),
    channels,
  });

  return channelsSettingsView(cwd, home);
}

/** Resolve tokens: env → connectors (migrating legacy settings) → "". */
export function resolveChannelSecrets(home: string): {
  telegramToken: string;
  slackBotToken: string;
  slackSigningSecret: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  dingtalkAppKey: string;
  dingtalkAppSecret: string;
  dingtalkVerificationToken: string;
} {
  const s = connectorSecrets(home);
  return {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || s.telegramBotToken || "",
    slackBotToken: process.env.SLACK_BOT_TOKEN?.trim() || s.slackBotToken || "",
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET?.trim() || s.slackSigningSecret || "",
    feishuAppId: process.env.FEISHU_APP_ID?.trim() || s.feishuAppId || "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET?.trim() || s.feishuAppSecret || "",
    feishuVerificationToken: process.env.FEISHU_VERIFICATION_TOKEN?.trim() || s.feishuVerificationToken || "",
    dingtalkAppKey: process.env.DINGTALK_APP_KEY?.trim() || s.dingtalkAppKey || "",
    dingtalkAppSecret: process.env.DINGTALK_APP_SECRET?.trim() || s.dingtalkAppSecret || "",
    dingtalkVerificationToken:
      process.env.DINGTALK_VERIFICATION_TOKEN?.trim() || s.dingtalkVerificationToken || "",
  };
}
