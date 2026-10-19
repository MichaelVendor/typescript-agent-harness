import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  clearSessionCookie,
  createSessions,
  readSessionId,
  sessionCookie,
  verifyPassword,
} from "./auth.js";
import { PAGE_HTML } from "./page.js";
import { proxyAgent } from "./proxy.js";
import { RuntimeNotReadyError, type ProjectRuntime } from "./runtime.js";
import type { Role, Store } from "./store.js";

export type StartControlOptions = {
  store: Store;
  host: string;
  port: number;
  runtime?: ProjectRuntime;
  lastTouch?: Map<string, number>;
  secret?: string;
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
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

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value) throw new HttpError(400, `${key} is required`);
  return value;
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startControl(
  opts: StartControlOptions,
): Promise<{ url: string; stop(): Promise<void> }> {
  const sessions = createSessions();
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, opts, sessions);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        json(res, err.status, { error: err.message });
        return;
      }
      json(res, 500, { error: "internal error" });
    }
  });
  const port = await listen(server, opts.host, opts.port);
  return {
    url: `http://${opts.host}:${port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartControlOptions,
  sessions: ReturnType<typeof createSessions>,
): Promise<void> {
  const store = opts.store;
  const url = new URL(req.url ?? "/", "http://control.local");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE_HTML);
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJson(req);
    const username = str(body, "username");
    const password = str(body, "password");
    const user = store.userByName(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, "invalid credentials");
    }
    const sid = sessions.create({ userId: user.id, username: user.username });
    res.setHeader("set-cookie", sessionCookie(sid));
    json(res, 200, { id: user.id, username: user.username });
    return;
  }

  const session = sessions.get(readSessionId(req.headers.cookie) ?? "");
  if (!session) throw new HttpError(401, "not signed in");

  if (method === "POST" && path === "/api/logout") {
    const sid = readSessionId(req.headers.cookie);
    if (sid) sessions.destroy(sid);
    res.setHeader("set-cookie", clearSessionCookie());
    json(res, 204);
    return;
  }

  if (method === "GET" && path === "/api/me") {
    json(res, 200, { id: session.userId, username: session.username });
    return;
  }

  if (method === "GET" && path === "/api/projects") {
    json(
      res,
      200,
      store.projectsFor(session.userId).map((project) => ({
        ...project,
        running: opts.lastTouch?.has(project.id) ?? false,
      })),
    );
    return;
  }

  if (method === "POST" && path === "/api/projects") {
    const name = str(await readJson(req), "name");
    json(res, 200, store.createProject(session.userId, name));
    return;
  }

  const wake = /^\/api\/projects\/([^/]+)\/wake$/.exec(path);
  if (wake && method === "POST") {
    const projectId = wake[1]!;
    if (!store.role(projectId, session.userId)) {
      throw new HttpError(403, "forbidden");
    }
    if (!opts.runtime) throw new HttpError(500, "runtime not configured");
    await ensureReady(opts.runtime, projectId);
    opts.lastTouch?.set(projectId, Date.now());
    json(res, 200, { status: "ready" });
    return;
  }

  const members = /^\/api\/projects\/([^/]+)\/members$/.exec(path);
  if (members && method === "GET") {
    const projectId = members[1]!;
    if (!store.role(projectId, session.userId)) throw new HttpError(403, "forbidden");
    json(res, 200, store.members(projectId));
    return;
  }
  if (members && method === "POST") {
    const projectId = members[1]!;
    if (store.role(projectId, session.userId) !== "owner") {
      throw new HttpError(403, "forbidden");
    }
    const body = await readJson(req);
    const username = str(body, "username");
    const role = str(body, "role");
    if (role !== "owner" && role !== "member") throw new HttpError(400, "invalid role");
    const user = store.userByName(username);
    if (!user) throw new HttpError(404, "user not found");
    store.addMember(projectId, user.id, role as Role);
    json(res, 204);
    return;
  }

  const agent = /^\/api\/projects\/([^/]+)\/agent\/(.*)$/.exec(path);
  if (agent) {
    const projectId = agent[1]!;
    const rest = agent[2]!;
    const health = method === "GET" && rest === "health";
    const v1 = rest === "v1" || rest.startsWith("v1/");
    if (!health && !v1) {
      json(res, 404, { error: "not found" });
      return;
    }
    if (!store.role(projectId, session.userId)) {
      throw new HttpError(403, "forbidden");
    }
    if (!opts.runtime) throw new HttpError(500, "runtime not configured");
    if (!opts.secret) throw new HttpError(500, "secret not configured");
    const { baseUrl } = await ensureReady(opts.runtime, projectId);
    opts.runtime.touch(projectId);
    opts.lastTouch?.set(projectId, Date.now());
    const status = await proxyAgent(req, res, {
      baseUrl,
      secret: opts.secret,
      projectId,
      userId: session.userId,
      suffix: `/${rest}${url.search}`,
    });
    store.audit({ userId: session.userId, projectId, route: path, status });
    return;
  }

  json(res, 404, { error: "not found" });
}

async function ensureReady(runtime: ProjectRuntime, projectId: string): Promise<{ baseUrl: string }> {
  try {
    return await runtime.ensure(projectId);
  } catch (err) {
    if (err instanceof RuntimeNotReadyError) throw new HttpError(503, err.message);
    throw err;
  }
}
