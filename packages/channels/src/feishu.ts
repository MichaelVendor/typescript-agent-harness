import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelAdapter, ChannelHandlers, ReplyHandle } from "./types.js";

export type FeishuReplyHandle = ReplyHandle & {
  kind: "feishu";
  chatId: string;
  /** reply in thread when present */
  messageId?: string;
};

export type FeishuAdapterOptions = {
  appId: string;
  appSecret: string;
  verificationToken: string;
  /** Optional encrypt key unused in P0 plaintext mode. */
  fetch?: typeof fetch;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function feishuThreadId(chatId: string, rootMessageId: string): string {
  return `feishu:chat/${chatId}:msg/${rootMessageId}`;
}

type FeishuBody = {
  type?: string;
  token?: string;
  challenge?: string;
  header?: { event_type?: string; token?: string };
  event?: {
    message?: {
      chat_id?: string;
      message_id?: string;
      root_id?: string;
      message_type?: string;
      content?: string;
      chat_type?: string;
      mentions?: unknown[];
    };
    sender?: { sender_type?: string };
  };
};

export function createFeishuAdapter(options: FeishuAdapterOptions): ChannelAdapter & {
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
} {
  const fetchFn = options.fetch ?? fetch;
  let handlers: ChannelHandlers | undefined;
  let tenantToken: { value: string; exp: number } | undefined;

  async function getTenantToken(): Promise<string> {
    const now = Date.now();
    if (tenantToken && tenantToken.exp > now + 60_000) return tenantToken.value;
    const res = await fetchFn("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
    });
    const json = (await res.json()) as {
      code: number;
      tenant_access_token?: string;
      expire?: number;
      msg?: string;
    };
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`feishu token: ${json.msg ?? json.code}`);
    }
    tenantToken = {
      value: json.tenant_access_token,
      exp: now + (json.expire ?? 7200) * 1000,
    };
    return tenantToken.value;
  }

  function ingest(body: FeishuBody): void {
    if (!handlers) return;
    const msg = body.event?.message;
    if (!msg?.chat_id || !msg.message_id) return;
    if (body.event?.sender?.sender_type === "app") return;
    let text = "";
    if (msg.message_type === "text" && msg.content) {
      try {
        const c = JSON.parse(msg.content) as { text?: string };
        text = c.text ?? "";
      } catch {
        text = msg.content;
      }
    }
    text = text.trim();
    if (!text) return;
    const chatType = msg.chat_type ?? "group";
    const mentioned = Array.isArray(msg.mentions) && msg.mentions.length > 0;
    if (chatType !== "p2p" && !mentioned && !msg.root_id) {
      console.log(`[feishu] skip chat=${msg.chat_id} (not p2p/@bot)`);
      return;
    }
    const root = msg.root_id || msg.message_id;
    const isNewThread = !msg.root_id;
    handlers.onMessage({
      source: "feishu",
      threadId: feishuThreadId(msg.chat_id, root),
      text,
      isNewThread,
      replyTo: {
        kind: "feishu",
        chatId: msg.chat_id,
        messageId: msg.message_id,
      },
    });
  }

  return {
    name: "feishu",
    async start(h) {
      handlers = h;
    },
    async stop() {
      handlers = undefined;
    },
    async send(replyTo, text) {
      if (replyTo.kind !== "feishu") throw new Error(`feishu send: bad handle ${replyTo.kind}`);
      const h = replyTo as FeishuReplyHandle;
      const token = await getTenantToken();
      const res = await fetchFn("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          receive_id: h.chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
      });
      const json = (await res.json()) as { code: number; msg?: string };
      if (json.code !== 0) throw new Error(`feishu send: ${json.msg ?? json.code}`);
    },
    async handleHttp(req, res) {
      const raw = await readBody(req);
      let body: FeishuBody;
      try {
        body = JSON.parse(raw) as FeishuBody;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      const token = body.token ?? body.header?.token;
      if (token && token !== options.verificationToken) {
        res.writeHead(401).end("bad token");
        return;
      }
      if (body.type === "url_verification" && body.challenge) {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ challenge: body.challenge }),
        );
        return;
      }
      res.writeHead(200).end("{}");
      try {
        ingest(body);
      } catch (err) {
        console.error("[feishu] ingest:", err instanceof Error ? err.message : err);
      }
    },
  };
}

export function ingestFeishuPayload(
  body: FeishuBody,
  onMessage: ChannelHandlers["onMessage"],
  verificationToken = "test-token",
): void {
  if (body.token && body.token !== verificationToken) return;
  const msg = body.event?.message;
  if (!msg?.chat_id || !msg.message_id) return;
  let text = "";
  if (msg.message_type === "text" && msg.content) {
    try {
      text = (JSON.parse(msg.content) as { text?: string }).text ?? "";
    } catch {
      text = msg.content;
    }
  }
  text = text.trim();
  if (!text) return;
  const root = msg.root_id || msg.message_id;
  onMessage({
    source: "feishu",
    threadId: feishuThreadId(msg.chat_id, root),
    text,
    isNewThread: !msg.root_id,
    replyTo: { kind: "feishu", chatId: msg.chat_id, messageId: msg.message_id },
  });
}
