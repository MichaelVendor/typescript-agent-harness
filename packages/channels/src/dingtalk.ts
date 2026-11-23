import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelAdapter, ChannelHandlers, ReplyHandle } from "./types.js";

export type DingTalkReplyHandle = ReplyHandle & {
  kind: "dingtalk";
  conversationId: string;
  msgId: string;
  sessionWebhook?: string;
};

export type DingTalkAdapterOptions = {
  /** App/robot client id (optional for sessionWebhook-only outbound). */
  appKey?: string;
  appSecret?: string;
  /** Shared token to reject bad webhooks (like feishu verificationToken). */
  verificationToken: string;
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

export function dingtalkThreadId(conversationId: string, rootMsgId: string): string {
  return `dingtalk:conv/${conversationId}:msg/${rootMsgId}`;
}

export type DingTalkBody = {
  msgtype?: string;
  text?: { content?: string };
  msgId?: string;
  conversationId?: string;
  conversationType?: string;
  sessionWebhook?: string;
  parentId?: string;
  token?: string;
};

function parseText(body: DingTalkBody): string {
  if (body.msgtype !== "text") return "";
  return (body.text?.content ?? "").trim();
}

function ingestBody(body: DingTalkBody, onMessage: ChannelHandlers["onMessage"]): void {
  const conversationId = body.conversationId;
  const msgId = body.msgId;
  if (!conversationId || !msgId) return;
  const text = parseText(body);
  if (!text) return;
  const rootMsgId = body.parentId || msgId;
  const isNewThread = !body.parentId;
  onMessage({
    source: "dingtalk",
    threadId: dingtalkThreadId(conversationId, rootMsgId),
    text,
    isNewThread,
    replyTo: {
      kind: "dingtalk",
      conversationId,
      msgId,
      ...(body.sessionWebhook ? { sessionWebhook: body.sessionWebhook } : {}),
    },
  });
}

export function ingestDingTalkPayload(
  body: DingTalkBody,
  onMessage: ChannelHandlers["onMessage"],
  verificationToken = "test-token",
): void {
  if (body.token && body.token !== verificationToken) return;
  ingestBody(body, onMessage);
}

export function createDingTalkAdapter(
  options: DingTalkAdapterOptions,
): ChannelAdapter & {
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
} {
  const fetchFn = options.fetch ?? fetch;
  let handlers: ChannelHandlers | undefined;
  let accessToken: { value: string; exp: number } | undefined;

  async function getAccessToken(): Promise<string> {
    if (!options.appKey || !options.appSecret) {
      throw new Error("dingtalk send: missing appKey/appSecret and no sessionWebhook on replyTo");
    }
    const now = Date.now();
    if (accessToken && accessToken.exp > now + 60_000) return accessToken.value;
    const url = new URL("https://oapi.dingtalk.com/gettoken");
    url.searchParams.set("appkey", options.appKey);
    url.searchParams.set("appsecret", options.appSecret);
    const res = await fetchFn(url.toString());
    const json = (await res.json()) as { errcode: number; access_token?: string; expires_in?: number; errmsg?: string };
    if (json.errcode !== 0 || !json.access_token) {
      throw new Error(`dingtalk token: ${json.errmsg ?? json.errcode}`);
    }
    accessToken = {
      value: json.access_token,
      exp: now + (json.expires_in ?? 7200) * 1000,
    };
    return accessToken.value;
  }

  return {
    name: "dingtalk",
    async start(h) {
      handlers = h;
    },
    async stop() {
      handlers = undefined;
    },
    async send(replyTo, text) {
      if (replyTo.kind !== "dingtalk") throw new Error(`dingtalk send: bad handle ${replyTo.kind}`);
      const h = replyTo as DingTalkReplyHandle;
      const payload = JSON.stringify({ msgtype: "text", text: { content: text } });

      if (h.sessionWebhook) {
        const res = await fetchFn(h.sessionWebhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        });
        const json = (await res.json()) as { errcode?: number; errmsg?: string };
        if (json.errcode !== undefined && json.errcode !== 0) {
          throw new Error(`dingtalk send: ${json.errmsg ?? json.errcode}`);
        }
        return;
      }

      const token = await getAccessToken();
      const sendUrl = new URL("https://oapi.dingtalk.com/robot/send");
      sendUrl.searchParams.set("access_token", token);
      const res = await fetchFn(sendUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: text },
          chatid: h.conversationId,
        }),
      });
      const json = (await res.json()) as { errcode?: number; errmsg?: string };
      if (json.errcode !== undefined && json.errcode !== 0) {
        throw new Error(`dingtalk send: ${json.errmsg ?? json.errcode}`);
      }
    },
    async handleHttp(req, res) {
      const raw = await readBody(req);
      let body: DingTalkBody;
      try {
        body = JSON.parse(raw) as DingTalkBody;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (body.token && body.token !== options.verificationToken) {
        res.writeHead(401).end("bad token");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ msgtype: "empty" }),
      );
      try {
        if (handlers) ingestBody(body, handlers.onMessage);
      } catch (err) {
        console.error("[dingtalk] ingest:", err instanceof Error ? err.message : err);
      }
    },
  };
}