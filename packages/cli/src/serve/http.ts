import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import path from "node:path";
import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import type { ChatHost } from "../host.js";
import { BusyError, type Hub } from "./hub.js";
import type { ServeInfo } from "./protocol.js";

const COOKIE = "tah_token";
const MAX_BODY = 1_000_000;
const HEARTBEAT_MS = 15_000;
const ANSWERS: ApprovalAnswer[] = ["yes", "always", "no"];
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
/** The page can approve commands, so nothing it renders may load scripts or send data elsewhere. */
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'";

export type ServeOptions = {
  host: ChatHost;
  hub: Hub;
  token: string;
  info: ServeInfo;
  /** Built web UI; may not exist in a source checkout. */
  webDir: string;
  persist: boolean;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieToken(req: IncomingMessage): string {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE) return value.join("=");
  }
  return "";
}

function json(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "body must be a JSON object");
  return body as Record<string, unknown>;
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `"${key}" must be a non-empty string`);
  return value;
}

/** Request handler plus `closeAll()` to end the event streams on shutdown. */
export function createServeHandler(opts: ServeOptions): { handle: RequestListener; closeAll(): void } {
  const { host, hub } = opts;
  const streams = new Set<ServerResponse>();
  const webDir = path.resolve(opts.webDir);

  const events = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    streams.add(res);
    const unsubscribe = hub.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  };

  const api = async (req: IncomingMessage, res: ServerResponse, route: string) => {
    if (req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, "cross-origin request");
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        throw new HttpError(415, "content-type must be application/json");
      }
    }
    const authed = sameToken(cookieToken(req), opts.token);
    const key = `${req.method} ${route}`;

    if (key === "POST /api/auth") {
      if (!sameToken(str(await readBody(req), "token"), opts.token)) throw new HttpError(401, "wrong token");
      res.setHeader("set-cookie", `${COOKIE}=${opts.token}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, 204);
    }
    if (!authed) throw new HttpError(401, "not signed in — open the link tah serve printed");

    switch (key) {
      case "GET /api/info":
        return json(res, 200, opts.info);
      case "GET /api/events":
        return events(req, res);
      case "GET /api/sessions":
        if (!opts.persist) throw new HttpError(409, "sessions are only saved with persist on (drop --no-persist)");
        return json(res, 200, await host.listSessions());
      case "POST /api/send": {
        const text = str(await readBody(req), "text");
        hub.start(() => host.send(text));
        return json(res, 202);
      }
      case "POST /api/continue":
        hub.start(() => host.continueTurn());
        return json(res, 202);
      case "POST /api/cancel":
        host.cancel();
        return json(res, 204);
      case "POST /api/answer": {
        const body = await readBody(req);
        const answer = body.answer as ApprovalAnswer;
        if (!ANSWERS.includes(answer)) throw new HttpError(400, `"answer" must be one of ${ANSWERS.join(", ")}`);
        host.answer(str(body, "id"), answer);
        return json(res, 204);
      }
      case "POST /api/reset":
        hub.assertIdle();
        await host.reset();
        return json(res, 204);
      case "POST /api/resume": {
        const ref = str(await readBody(req), "ref");
        hub.assertIdle();
        await host.resume(ref);
        return json(res, 204);
      }
      case "POST /api/fork": {
        const turns = (await readBody(req)).turns;
        if (turns !== undefined && !(Number.isInteger(turns) && (turns as number) >= 0)) {
          throw new HttpError(400, '"turns" must be a non-negative integer');
        }
        hub.assertIdle();
        await host.fork(turns as number | undefined);
        return json(res, 204);
      }
    }
    throw new HttpError(404, `no such endpoint: ${key}`);
  };

  const page = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
    if (!existsSync(webDir)) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("web UI not built — run pnpm build\n");
      return;
    }
    const file = path.extname(pathname) ? path.resolve(webDir, `.${pathname}`) : path.join(webDir, "index.html");
    if (!file.startsWith(webDir + path.sep) || !(await stat(file).catch(() => undefined))?.isFile()) {
      throw new HttpError(404, "not found");
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  };

  const handle: RequestListener = (req, res) => {
    const port = req.socket.localPort;
    const hostHeader = req.headers.host;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: "bad path" });
    }
    const work =
      hostHeader !== `127.0.0.1:${port}` && hostHeader !== `localhost:${port}`
        ? Promise.reject(new HttpError(403, "unexpected Host header"))
        : pathname.startsWith("/api/")
          ? api(req, res, pathname)
          : page(req, res, pathname);
    work.catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      if (err instanceof BusyError) return json(res, 409, { error: err.message });
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  };

  return {
    handle,
    closeAll() {
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
