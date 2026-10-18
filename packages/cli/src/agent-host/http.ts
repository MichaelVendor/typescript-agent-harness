import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { verifyAgentHostToken, type AgentHostClaims } from "./auth.js";
import type { ChatHost } from "../host.js";

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

export function createAgentHostHandler(opts: AgentHostHandlerOptions): RequestListener {
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
