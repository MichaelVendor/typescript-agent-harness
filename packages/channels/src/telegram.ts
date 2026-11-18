import type { ChannelAdapter, ChannelHandlers, ReplyHandle } from "./types.js";

export type TelegramReplyHandle = ReplyHandle & {
  kind: "telegram";
  chatId: number | string;
  messageThreadId?: number;
};

export type TelegramAdapterOptions = {
  token: string;
  /** Inject fetch for tests. */
  fetch?: typeof fetch;
  /** Polling interval base (ms). */
  pollTimeoutSec?: number;
  /** Stop polling when aborted. */
  signal?: AbortSignal;
};

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    message_thread_id?: number;
    entities?: { type: string; offset: number; length: number }[];
  };
};

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

export function telegramThreadId(chatId: number | string, topicId?: number): string {
  if (topicId !== undefined) return `tg:chat/${chatId}:topic/${topicId}`;
  return `tg:chat/${chatId}`;
}

/** True when private chat, or group message that @mentions the bot / is a reply command. */
export function shouldHandleTelegramMessage(
  text: string,
  chatType: string,
  entities: { type: string }[] | undefined,
): boolean {
  if (chatType === "private") return true;
  if (entities?.some((e) => e.type === "mention" || e.type === "bot_command")) return true;
  if (/^@\w+/.test(text.trim())) return true;
  return false;
}

export function createTelegramAdapter(options: TelegramAdapterOptions): ChannelAdapter {
  const fetchFn = options.fetch ?? fetch;
  const pollTimeout = options.pollTimeoutSec ?? 25;
  let handlers: ChannelHandlers | undefined;
  let offset = 0;
  let stopped = true;
  let loop: Promise<void> | undefined;

  async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(apiUrl(options.token, method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
    return json.result as T;
  }

  async function pollOnce(): Promise<void> {
    const updates = await call<TgUpdate[]>("getUpdates", {
      offset,
      timeout: pollTimeout,
      allowed_updates: ["message"],
    });
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m?.text || !handlers) continue;
      if (!shouldHandleTelegramMessage(m.text, m.chat.type, m.entities)) {
        console.log(`[telegram] skip chat=${m.chat.id} (not DM/@bot)`);
        continue;
      }
      const topic = m.message_thread_id;
      const threadId = telegramThreadId(m.chat.id, topic);
      const isNewThread = topic === undefined;
      const replyTo: TelegramReplyHandle = {
        kind: "telegram",
        chatId: m.chat.id,
        ...(topic !== undefined ? { messageThreadId: topic } : {}),
      };
      handlers.onMessage({
        source: "telegram",
        threadId,
        text: m.text,
        isNewThread,
        replyTo,
      });
    }
  }

  return {
    name: "telegram",
    async start(h) {
      handlers = h;
      stopped = false;
      loop = (async () => {
        while (!stopped) {
          if (options.signal?.aborted) break;
          try {
            await pollOnce();
          } catch (err) {
            if (stopped) break;
            console.error("[telegram] poll error:", err instanceof Error ? err.message : err);
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      })();
    },
    async stop() {
      stopped = true;
      handlers = undefined;
      await loop;
    },
    async send(replyTo, text) {
      if (replyTo.kind !== "telegram") throw new Error(`telegram send: bad handle ${replyTo.kind}`);
      const h = replyTo as TelegramReplyHandle;
      await call("sendMessage", {
        chat_id: h.chatId,
        text,
        ...(h.messageThreadId !== undefined ? { message_thread_id: h.messageThreadId } : {}),
      });
    },
  };
}

/** Parse a recorded getUpdates result for tests. */
export function parseTelegramUpdates(
  updates: TgUpdate[],
  onMessage: ChannelHandlers["onMessage"],
): void {
  for (const u of updates) {
    const m = u.message;
    if (!m?.text) continue;
    if (!shouldHandleTelegramMessage(m.text, m.chat.type, m.entities)) continue;
    const topic = m.message_thread_id;
    onMessage({
      source: "telegram",
      threadId: telegramThreadId(m.chat.id, topic),
      text: m.text,
      isNewThread: topic === undefined,
      replyTo: {
        kind: "telegram",
        chatId: m.chat.id,
        ...(topic !== undefined ? { messageThreadId: topic } : {}),
      },
    });
  }
}
