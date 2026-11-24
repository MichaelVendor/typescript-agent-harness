import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveChannelSecrets } from "../channels-settings.js";

export type ChannelHostFileConfig = {
  persistDir?: string;
  port?: number;
  channels?: {
    telegram?: { enabled?: boolean; mirrorChatId?: number | string | null };
    slack?: { enabled?: boolean };
    feishu?: { enabled?: boolean };
    dingtalk?: { enabled?: boolean };
    wecom?: { enabled?: boolean };
  };
};

export type ChannelHostResolved = {
  persistDir: string;
  port: number;
  telegram: { enabled: boolean; token: string };
  slack: { enabled: boolean; botToken: string; signingSecret: string };
  feishu: {
    enabled: boolean;
    appId: string;
    appSecret: string;
    verificationToken: string;
  };
  dingtalk: {
    enabled: boolean;
    appKey: string;
    appSecret: string;
    verificationToken: string;
  };
  wecom: {
    enabled: boolean;
    corpId: string;
    agentId: string;
    secret: string;
    token: string;
  };
};

export function loadChannelHostConfig(
  cwd: string,
  opts?: { port?: number; homeDir?: string },
): ChannelHostResolved {
  const filePath = path.join(cwd, "tah.channels.json");
  let file: ChannelHostFileConfig = {};
  if (existsSync(filePath)) {
    file = JSON.parse(readFileSync(filePath, "utf8")) as ChannelHostFileConfig;
  }
  const persistDir = path.resolve(cwd, file.persistDir ?? ".tah/super-agent");
  const port = opts?.port && opts.port > 0 ? opts.port : (file.port ?? 7430);
  const ch = file.channels ?? {};
  const secrets = resolveChannelSecrets(opts?.homeDir ?? os.homedir());
  return {
    persistDir,
    port,
    telegram: {
      enabled: ch.telegram?.enabled === true,
      token: secrets.telegramToken,
    },
    slack: {
      enabled: ch.slack?.enabled === true,
      botToken: secrets.slackBotToken,
      signingSecret: secrets.slackSigningSecret,
    },
    feishu: {
      enabled: ch.feishu?.enabled === true,
      appId: secrets.feishuAppId,
      appSecret: secrets.feishuAppSecret,
      verificationToken: secrets.feishuVerificationToken,
    },
    dingtalk: {
      enabled: ch.dingtalk?.enabled === true,
      appKey: secrets.dingtalkAppKey,
      appSecret: secrets.dingtalkAppSecret,
      verificationToken: secrets.dingtalkVerificationToken,
    },
    wecom: {
      enabled: ch.wecom?.enabled === true,
      corpId: secrets.wecomCorpId,
      agentId: secrets.wecomAgentId,
      secret: secrets.wecomSecret,
      token: secrets.wecomToken,
    },
  };
}
