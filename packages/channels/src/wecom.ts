import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelAdapter, ChannelHandlers, ReplyHandle } from "./types.js";

export type WeComReplyHandle = ReplyHandle & {
  kind: "wecom";
  chatId: string;
  userId?: string;
  msgId: string;
};

export type WeComAdapterOptions = {
  corpId: string;
  agentId: string;
  secret: string;
  /** Token for URL verify / inbound gate (plaintext P1). */
  token: string;
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

export function wecomThreadId(chatId: string, msgId: string): string {
  return `wecom:chat/${chatId}:msg/${msgId}`;
}

export type WeComBody = {
  MsgType?: string;
  Content?: string;
  FromUserName?: string;
  AgentID?: string;
  MsgId?: string;
  ChatId?: string;
  ParentMsgId?: string;
  token?: string;
};

function chatKey(body: WeComBody): string | undefined {
  if (body.ChatId?.trim()) return body.ChatId.trim();
  if (body.FromUserName?.trim()) return `p2p:${body.FromUserName.trim()}`;
  return undefined;
}

function ingestBody(body: WeComBody, onMessage: ChannelHandlers["onMessage"]): void {
  const chatId = chatKey(body);
  const msgId = body.MsgId;
  if (!chatId || !msgId) return;
  if (body.MsgType !== "text") return;
  const text = (body.Content ?? "").trim();
  if (!text) return;
  const rootMsgId = body.ParentMsgId?.trim() || msgId;
  const isNewThread = !body.ParentMsgId?.trim();
  const userId = body.FromUserName?.trim();
  onMessage({
    source: "wecom",
    threadId: wecomThreadId(chatId, rootMsgId),
    text,
    isNewThread,
    replyTo: {
      kind: "wecom",
      chatId,
      msgId,
      ...(userId ? { userId } : {}),
    },
  });
}

export function ingestWeComPayload(
  body: WeComBody,
  onMessage: ChannelHandlers["onMessage"],
  token = "test-token",
): void {
  if (body.token && body.token !== token) return;
  ingestBody(body, onMessage);
}

/** P1 plaintext demo: echo `echostr` when query `token` matches (no SHA1). */
export function handleWeComUrlVerify(
  query: URLSearchParams,
  token: string,
): { status: number; body: string } | undefined {
  const echostr = query.get("echostr");
  if (!echostr) return undefined;
  const qToken = query.get("token");
  if (qToken && qToken !== token) return { status: 401, body: "bad token" };
  if (!qToken) return { status: 401, body: "bad token" };
  return { status: 200, body: echostr };
}

export function createWeComAdapter(
  options: WeComAdapterOptions,
): ChannelAdapter & {
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
} {
  const fetchFn = options.fetch ?? fetch;
  let handlers: ChannelHandlers | undefined;
  let accessToken: { value: string; exp: number } | undefined;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (accessToken && accessToken.exp > now + 60_000) return accessToken.value;
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    url.searchParams.set("corpid", options.corpId);
    url.searchParams.set("corpsecret", options.secret);
    const res = await fetchFn(url.toString());
    const json = (await res.json()) as { errcode: number; access_token?: string; expires_in?: number; errmsg?: string };
    if (json.errcode !== 0 || !json.access_token) {
      throw new Error(`wecom token: ${json.errmsg ?? json.errcode}`);
    }
    accessToken = {
      value: json.access_token,
      exp: now + (json.expires_in ?? 7200) * 1000,
    };
    return accessToken.value;
  }

  return {
    name: "wecom",
    async start(h) {
      handlers = h;
    },
    async stop() {
      handlers = undefined;
    },
    async send(replyTo, text) {
      if (replyTo.kind !== "wecom") throw new Error(`wecom send: bad handle ${replyTo.kind}`);
      const h = replyTo as WeComReplyHandle;
      const token = await getAccessToken();
      const agentId = Number(options.agentId);
      const isP2p = h.chatId.startsWith("p2p:");
      const payload: Record<string, unknown> = {
        msgtype: "text",
        agentid: agentId,
        text: { content: text },
        safe: 0,
      };
      if (isP2p) {
        payload.touser = h.userId ?? h.chatId.slice(4);
      } else {
        payload.chatid = h.chatId;
      }
      const sendUrl = new URL("https://qyapi.weixin.qq.com/cgi-bin/message/send");
      sendUrl.searchParams.set("access_token", token);
      const res = await fetchFn(sendUrl.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { errcode?: number; errmsg?: string };
      if (json.errcode !== undefined && json.errcode !== 0) {
        throw new Error(`wecom send: ${json.errmsg ?? json.errcode}`);
      }
    },
    async handleHttp(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET") {
        const verify = handleWeComUrlVerify(url.searchParams, options.token);
        if (verify) {
          res.writeHead(verify.status, { "content-type": "text/plain" }).end(verify.body);
          return;
        }
        res.writeHead(404).end("not found");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end("method not allowed");
        return;
      }
      const raw = await readBody(req);
      let body: WeComBody;
      try {
        body = JSON.parse(raw) as WeComBody;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (body.token && body.token !== options.token) {
        res.writeHead(401).end("bad token");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      try {
        if (handlers) ingestBody(body, handlers.onMessage);
      } catch (err) {
        console.error("[wecom] ingest:", err instanceof Error ? err.message : err);
      }
    },
  };
}