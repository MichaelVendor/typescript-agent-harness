/**
 * Project IM toggles → `<cwd>/tah.channels.json`.
 * Bot secrets → `~/.tah/settings.json` (same vault as model keys); env still wins when set.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  settingsVal: string | undefined,
  envVal: string | undefined,
): { hint: string | null; source: "settings" | "env" | null } {
  if (envVal?.trim()) return { hint: keyHint(envVal.trim()), source: "env" };
  if (settingsVal?.trim()) return { hint: keyHint(settingsVal.trim()), source: "settings" };
  return { hint: null, source: null };
}

export function channelsSettingsView(cwd: string, home: string): ChannelsSettingsView {
  const file = readChannelsFile(cwd);
  const ch = file.channels ?? {};
  const secrets = loadSettings(home).channels ?? {};
  const tg = hintSource(secrets.telegramBotToken, process.env.TELEGRAM_BOT_TOKEN);
  const slackBot = hintSource(secrets.slackBotToken, process.env.SLACK_BOT_TOKEN);
  const slackSign = hintSource(secrets.slackSigningSecret, process.env.SLACK_SIGNING_SECRET);
  const feishuId = hintSource(secrets.feishuAppId, process.env.FEISHU_APP_ID);
  const feishuSecret = hintSource(secrets.feishuAppSecret, process.env.FEISHU_APP_SECRET);
  const feishuTok = hintSource(secrets.feishuVerificationToken, process.env.FEISHU_VERIFICATION_TOKEN);
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
  return {
    telegram,
    slack,
    feishu,
    anyEnabled: telegram.enabled || slack.enabled || feishu.enabled,
  };
}

function applySecret(
  secrets: ChannelSecrets,
  key: keyof ChannelSecrets,
  value: string | null | undefined,
): ChannelSecrets {
  if (value === undefined) return secrets;
  const next = { ...secrets };
  if (value === null) {
    delete next[key];
    return next;
  }
  const trimmed = value.trim();
  if (!trimmed) return secrets;
  next[key] = trimmed;
  return next;
}

export function saveChannelsSettings(cwd: string, home: string, patch: ChannelsSettingsPatch): ChannelsSettingsView {
  const file = readChannelsFile(cwd);
  const channels = { ...(file.channels ?? {}) };
  let secrets: ChannelSecrets = { ...(loadSettings(home).channels ?? {}) };

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
    secrets = applySecret(secrets, "telegramBotToken", t.botToken);
  }
  if (patch.slack) {
    const s = patch.slack;
    const prev = { ...(channels.slack ?? {}) };
    if (s.enabled !== undefined) prev.enabled = s.enabled;
    channels.slack = prev;
    secrets = applySecret(secrets, "slackBotToken", s.botToken);
    secrets = applySecret(secrets, "slackSigningSecret", s.signingSecret);
  }
  if (patch.feishu) {
    const f = patch.feishu;
    const prev = { ...(channels.feishu ?? {}) };
    if (f.enabled !== undefined) prev.enabled = f.enabled;
    channels.feishu = prev;
    secrets = applySecret(secrets, "feishuAppId", f.appId);
    secrets = applySecret(secrets, "feishuAppSecret", f.appSecret);
    secrets = applySecret(secrets, "feishuVerificationToken", f.verificationToken);
  }

  writeChannelsFile(cwd, {
    persistDir: file.persistDir ?? ".tah/super-agent",
    ...(file.port !== undefined ? { port: file.port } : {}),
    channels,
  });

  const base = loadSettings(home);
  const { channels: _, ...rest } = base;
  saveHomeSettings(
    home,
    Object.keys(secrets).length > 0 ? { ...rest, channels: secrets } : rest,
  );

  return channelsSettingsView(cwd, home);
}

/** Resolve tokens: env → settings → "". */
export function resolveChannelSecrets(home: string): {
  telegramToken: string;
  slackBotToken: string;
  slackSigningSecret: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
} {
  const s = loadSettings(home).channels ?? {};
  return {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || s.telegramBotToken || "",
    slackBotToken: process.env.SLACK_BOT_TOKEN?.trim() || s.slackBotToken || "",
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET?.trim() || s.slackSigningSecret || "",
    feishuAppId: process.env.FEISHU_APP_ID?.trim() || s.feishuAppId || "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET?.trim() || s.feishuAppSecret || "",
    feishuVerificationToken: process.env.FEISHU_VERIFICATION_TOKEN?.trim() || s.feishuVerificationToken || "",
  };
}
