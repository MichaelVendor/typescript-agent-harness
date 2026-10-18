import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { ChatHost, HostEvent } from "../host.js";
import { verifyAgentHostToken, type AgentHostClaims } from "./auth.js";
import { writeHostEvent } from "./sse.js";

export type AgentHostHandlerOptions = {
  secret: string;
  projectId: string;
  host: ChatHost;
  version: string;
  cwd: string;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

function requireAuth(req: IncomingMessage, secret: string, projectId: string): AgentHostClaims {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  if (!match) throw new HttpError(401, "missing token");
  try {
    return verifyAgentHostToken(secret, match[1]!, projectId);
  } catch (err) {
    throw new HttpError(401, err instanceof Error ? err.message : "invalid token");
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

async function ensureSession(host: ChatHost, id: string, busy: boolean): Promise<void> {
  if (busy) throw new HttpError(409, "turn_in_progress");
  if (host.sessionId === id) return;
  await host.resume(id);
}

/** Writes this turn's HostEvents. Subscribe before `send` so the opening `user` event is not missed. */
function streamTurn(req: IncomingMessage, res: ServerResponse, host: ChatHost, text: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  let ended = false;
  const unsubscribe = host.on((event) => {
    if (ended || res.writableEnded) return;
    writeHostEvent(res, event);
    if (event.type === "turn.end" || event.type === "turn.error") {
      ended = true;
      unsubscribe();
      res.end();
    }
  });
  const stop = () => {
    if (ended) return;
    ended = true;
    unsubscribe();
    host.cancel();
  };
  res.on("close", stop);
  req.on("aborted", stop);
  if (ended) return;
  void host.send(text).catch((err: unknown) => {
    if (ended || res.writableEnded) return;
    ended = true;
    unsubscribe();
    if (res.headersSent) {
      res.end();
      return;
    }
    json(res, 400, { error: err instanceof Error ? err.message : String(err) });
  });
}

function sessionAction(pathname: string): { id: string; action: "messages" | "cancel" } | undefined {
  const match = /^\/v1\/sessions\/([^/]+)\/(messages|cancel)$/.exec(pathname);
  if (!match?.[1] || (match[2] !== "messages" && match[2] !== "cancel")) return undefined;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

export function createAgentHostHandler(opts: AgentHostHandlerOptions): RequestListener {
  let busy = false;
  opts.host.on((event: HostEvent) => {
    if (event.type === "user") busy = true;
    else if (event.type === "turn.end" || event.type === "turn.error") busy = false;
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, { ok: true, projectId: opts.projectId });
    }
    requireAuth(req, opts.secret, opts.projectId);
    if (req.method === "GET" && pathname === "/v1/sessions") {
      return json(res, 200, await opts.host.listSessions());
    }
    if (req.method === "POST" && pathname === "/v1/sessions") {
      const body = await readJson(req);
      await opts.host.reset();
      const sessionId = opts.host.sessionId;
      if (typeof body.title === "string" && body.title) {
        await opts.host.renameSession(sessionId, body.title);
      }
      return json(res, 201, { sessionId });
    }
    if (req.method === "GET" && pathname === "/v1/info") {
      return json(res, 200, { approve: opts.host.approve, version: opts.version, cwd: opts.cwd });
    }
    const action = req.method === "POST" ? sessionAction(pathname) : undefined;
    if (action?.action === "cancel") {
      if (action.id !== opts.host.sessionId) await ensureSession(opts.host, action.id, busy);
      opts.host.cancel();
      return json(res, 204);
    }
    if (action?.action === "messages") {
      const body = await readJson(req);
      const text = body.text;
      if (typeof text !== "string" || text.trim() === "") throw new HttpError(400, "message is empty");
      await ensureSession(opts.host, action.id, busy);
      if (busy) throw new HttpError(409, "turn_in_progress");
      streamTurn(req, res, opts.host, text);
      return;
    }
    return json(res, 404, { error: "not found" });
  };

  return (req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
