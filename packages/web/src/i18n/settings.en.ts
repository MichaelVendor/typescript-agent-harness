/**
 * Settings UI copy (English). Keep keys stable for future locales (`settings.zh.ts`, …).
 */
export const settingsEn = {
  title: "Settings",
  close: "Close settings",
  sections: {
    models: "Models",
    web: "Web search",
    skills: "Skills",
    channels: "Messaging",
    integrations: "Integrations",
  },
  integrations: {
    desc: "Connect accounts through the OAuth apps configured for this local tah server.",
    githubEnv: "Requires TAH_GITHUB_CLIENT_ID and TAH_GITHUB_CLIENT_SECRET in the serve environment.",
    feishuEnv:
      "Requires TAH_FEISHU_CLIENT_ID and TAH_FEISHU_CLIENT_SECRET (or FEISHU_APP_ID / FEISHU_APP_SECRET) in the serve environment.",
  },
  channels: {
    introBeforeSecrets: "Turn on a channel and paste bot credentials. Secrets stay on this computer in ",
    introBetween: " (only a hint is shown here). Enable/disable flags are stored in this folder’s ",
    introAfter: ". With a channel on, web chat bridges to that IM via Super-agent.",
    save: "Save",
    savedNote: "Saved. Messaging channels are applied now — no restart needed.",
    busyNote: "Wait for the current reply to finish before changing channels.",
    leaveBlank: "leave blank to keep",
    fromEnv: "from .env",
    fromSettings: "saved in settings",
    notSet: "not set",
    on: "On",
    telegram: {
      title: "Telegram",
      hintBefore: "Create a bot with",
      hintAfter:
        ", copy the token. Message the bot once to link your chat (saved as mirrorChatId); after that, web and Telegram stay in sync across reloads.",
      botToken: "Bot token",
      mirrorChatId: "mirrorChatId (optional)",
      mirrorPlaceholder: "Your Telegram numeric chat id",
      mirrorHelp: "Usually leave empty — the first Telegram message to the bot saves it automatically.",
    },
    slack: {
      title: "Slack",
      hint: "Events API + bot token. Local hooks default to 127.0.0.1:7430 (use a tunnel for a public URL).",
      botToken: "Bot token",
      signingSecret: "Signing secret",
    },
    feishu: {
      title: "Feishu / Lark",
      hint: "Event-subscription app; credentials come from the Feishu Open Platform.",
      appId: "App ID",
      appSecret: "App Secret",
      verificationToken: "Verification token",
    },
    dingtalk: {
      title: "DingTalk",
      hint: "Enterprise robot / callback app from the DingTalk Open Platform. Local hooks at /hooks/dingtalk.",
      appKey: "App key",
      appSecret: "App secret",
      verificationToken: "Verification token",
    },
    wecom: {
      title: "WeCom",
      hint: "Enterprise WeChat self-built app; callback URL at /hooks/wecom (URL verification uses token + corp secret).",
      corpId: "Corp ID",
      agentId: "Agent ID",
      secret: "Secret",
      token: "Token",
    },
  },
} as const;

export type SettingsMessages = typeof settingsEn;

/** Active Settings locale. Swap or merge when adding languages. */
export const settingsMessages: SettingsMessages = settingsEn;
