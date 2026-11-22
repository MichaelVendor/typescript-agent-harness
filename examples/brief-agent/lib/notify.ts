export type NotifyChannel = "telegram" | "feishu";

export type NotifyDeps = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

function parseChannels(raw: string | undefined): NotifyChannel[] {
  if (!raw?.trim()) return [];
  const out: NotifyChannel[] = [];
  for (const part of raw.split(",")) {
    const c = part.trim().toLowerCase();
    if (c === "telegram" || c === "feishu") {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

function clip(text: string, max = 3500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export type NotifyBriefInput = {
  subscriptionId: string;
  markdown: string;
  mdPath?: string;
};

export type NotifyResult = { channel: NotifyChannel; ok: boolean; detail: string };

async function sendTelegram(
  text: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<NotifyResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.BRIEF_TG_CHAT_ID?.trim();
  if (!token || !chatId) {
    return { channel: "telegram", ok: false, detail: "missing TELEGRAM_BOT_TOKEN or BRIEF_TG_CHAT_ID" };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: clip(text),
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { channel: "telegram", ok: false, detail: `HTTP ${res.status} ${body.slice(0, 200)}` };
  }
  return { channel: "telegram", ok: true, detail: "sent" };
}

async function sendFeishu(
  text: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<NotifyResult> {
  const webhook = env.BRIEF_FEISHU_WEBHOOK?.trim();
  if (!webhook) {
    return { channel: "feishu", ok: false, detail: "missing BRIEF_FEISHU_WEBHOOK" };
  }
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msg_type: "text",
      content: { text: clip(text) },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { channel: "feishu", ok: false, detail: `HTTP ${res.status} ${body.slice(0, 200)}` };
  }
  return { channel: "feishu", ok: true, detail: "sent" };
}

/** 按 BRIEF_NOTIFY 推送简报摘要；缺配置或失败不抛。 */
export async function notifyBrief(
  input: NotifyBriefInput,
  deps?: NotifyDeps,
): Promise<NotifyResult[]> {
  const env = deps?.env ?? process.env;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const channels = parseChannels(env.BRIEF_NOTIFY);
  if (channels.length === 0) return [];

  const header = `brief-agent · ${input.subscriptionId}`;
  const pathLine = input.mdPath ? `\n${input.mdPath}` : "";
  const body = `${header}${pathLine}\n\n${input.markdown}`;
  const results: NotifyResult[] = [];

  for (const channel of channels) {
    try {
      if (channel === "telegram") {
        results.push(await sendTelegram(body, env, fetchImpl));
      } else {
        results.push(await sendFeishu(body, env, fetchImpl));
      }
    } catch (error) {
      results.push({
        channel,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
