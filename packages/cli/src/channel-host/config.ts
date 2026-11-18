import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ChannelHostFileConfig = {
  persistDir?: string;
  port?: number;
  channels?: {
    telegram?: { enabled?: boolean };
    slack?: { enabled?: boolean };
    feishu?: { enabled?: boolean };
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
};

export function loadChannelHostConfig(cwd: string, opts?: { port?: number }): ChannelHostResolved {
  const filePath = path.join(cwd, "tah.channels.json");
  let file: ChannelHostFileConfig = {};
  if (existsSync(filePath)) {
    file = JSON.parse(readFileSync(filePath, "utf8")) as ChannelHostFileConfig;
  }
  const persistDir = path.resolve(cwd, file.persistDir ?? ".tah/super-agent");
  const port = opts?.port && opts.port > 0 ? opts.port : (file.port ?? 7430);
  const ch = file.channels ?? {};
  return {
    persistDir,
    port,
    telegram: {
      enabled: ch.telegram?.enabled === true,
      token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    },
    slack: {
      enabled: ch.slack?.enabled === true,
      botToken: process.env.SLACK_BOT_TOKEN ?? "",
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
    },
    feishu: {
      enabled: ch.feishu?.enabled === true,
      appId: process.env.FEISHU_APP_ID ?? "",
      appSecret: process.env.FEISHU_APP_SECRET ?? "",
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    },
  };
}
