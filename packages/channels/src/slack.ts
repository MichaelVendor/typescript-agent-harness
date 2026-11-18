import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelAdapter, ChannelHandlers, ReplyHandle } from "./types.js";

export type SlackReplyHandle = ReplyHandle & {
  kind: "slack";
  channel: string;
  threadTs?: string;
};

export type SlackAdapterOptions = {
  botToken: string;
  signingSecret: string;
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

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function slackThreadId(team: string, channel: string, threadTs: string): string {
  return `slack:${team}:${channel}:${threadTs}`;
}

type SlackEventPayload = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
};

export function createSlackAdapter(options: SlackAdapterOptions): ChannelAdapter & {
  /** Mount on channel-host HTTP: POST /hooks/slack */
  handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void>;
} {
  const fetchFn = options.fetch ?? fetch;
  let handlers: ChannelHandlers | undefined;

  async function postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
    const res = await fetchFn("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) throw new Error(`slack postMessage: ${json.error ?? res.status}`);
  }

  function ingestEvent(payload: SlackEventPayload): void {
    if (!handlers) return;
    const ev = payload.event;
    if (!ev || ev.bot_id) return;
    const typ = ev.type;
    if (typ !== "app_mention" && typ !== "message") return;
    const isDm = ev.channel_type === "im";
    const isThread = Boolean(ev.thread_ts);
    const mentioned = Boolean(ev.text?.includes("<@"));
    if (typ === "message" && !isDm && !isThread && !mentioned) {
      console.log(`[slack] skip channel=${ev.channel} (not DM/@bot)`);
      return;
    }
    const channel = ev.channel ?? "";
    const team = payload.team_id ?? "unknown";
    const rootTs = ev.thread_ts ?? ev.ts ?? "";
    const isNewThread = !ev.thread_ts;
    const text = (ev.text ?? "").replace(/<@[A-Za-z0-9]+>/g, "").trim();
    if (!text) return;
    const replyTo: SlackReplyHandle = {
      kind: "slack",
      channel,
      ...(ev.thread_ts || ev.ts ? { threadTs: ev.thread_ts ?? ev.ts } : {}),
    };
    handlers.onMessage({
      source: "slack",
      threadId: slackThreadId(team, channel, rootTs),
      text,
      isNewThread,
      replyTo,
    });
  }

  return {
    name: "slack",
    async start(h) {
      handlers = h;
    },
    async stop() {
      handlers = undefined;
    },
    async send(replyTo, text) {
      if (replyTo.kind !== "slack") throw new Error(`slack send: bad handle ${replyTo.kind}`);
      const h = replyTo as SlackReplyHandle;
      await postMessage(h.channel, text, h.threadTs);
    },
    async handleHttp(req, res) {
      const raw = await readBody(req);
      const ts = String(req.headers["x-slack-request-timestamp"] ?? "");
      const sig = String(req.headers["x-slack-signature"] ?? "");
      if (!verifySlackSignature(options.signingSecret, raw, ts, sig)) {
        res.writeHead(401).end("invalid signature");
        return;
      }
      let payload: SlackEventPayload;
      try {
        payload = JSON.parse(raw) as SlackEventPayload;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (payload.type === "url_verification" && payload.challenge) {
        res.writeHead(200, { "content-type": "text/plain" }).end(payload.challenge);
        return;
      }
      res.writeHead(200).end();
      try {
        ingestEvent(payload);
      } catch (err) {
        console.error("[slack] ingest:", err instanceof Error ? err.message : err);
      }
    },
  };
}

/** Test helper: process a parsed Events API body without HTTP. */
export function ingestSlackPayload(
  payload: SlackEventPayload,
  onMessage: ChannelHandlers["onMessage"],
): void {
  const ev = payload.event;
  if (!ev || ev.bot_id) return;
  const typ = ev.type;
  if (typ !== "app_mention" && typ !== "message") return;
  const isDm = ev.channel_type === "im";
  const isThread = Boolean(ev.thread_ts);
  const mentioned = Boolean(ev.text?.includes("<@")) || typ === "app_mention";
  if (typ === "message" && !isDm && !isThread && !mentioned) return;
  const channel = ev.channel ?? "";
  const team = payload.team_id ?? "unknown";
  const rootTs = ev.thread_ts ?? ev.ts ?? "";
  const text = (ev.text ?? "").replace(/<@[A-Za-z0-9]+>/g, "").trim();
  if (!text) return;
  onMessage({
    source: "slack",
    threadId: slackThreadId(team, channel, rootTs),
    text,
    isNewThread: !ev.thread_ts,
    replyTo: {
      kind: "slack",
      channel,
      ...(ev.thread_ts || ev.ts ? { threadTs: ev.thread_ts ?? ev.ts } : {}),
    },
  });
}
