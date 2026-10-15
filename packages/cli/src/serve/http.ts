import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import { AttachmentError, createAttachmentStore, MAX_FILE_BYTES } from "../attachments/store.js";
import { chooseFolder, UnsupportedError } from "./choose.js";
import { contentType, fileKind, NotInFolderError, resolveInFolder, sendFile } from "./files.js";
import { listDirs, makeDir } from "./fs.js";
import { BusyError, type Hub } from "./hub.js";
import {
  activeModel,
  addModel,
  defaultBaseURL,
  keyHint,
  loadSettings,
  removeModel,
  searchKey,
  setActiveModel,
  setModelVision,
  setSearchKey,
} from "../settings.js";
import { discoverSkills } from "../skills/discover.js";
import { importSkills, removeSkill } from "../skills/install.js";
import type { FileStat, ServeInfo, SettingsView, SkillsView } from "./protocol.js";
import { browserURL, createScreen, parseInput, type Cdp } from "./screen.js";
import { ConflictError, type Workspaces } from "./workspaces.js";

const COOKIE = "tah_token";
const MAX_BODY = 1_000_000;
const MAX_UPLOAD = MAX_FILE_BYTES;
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
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";
/** Agent-made pages run as an opaque origin: no sign-in cookie, no `/api`. */
const PREVIEW_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals";

export type ServeOptions = {
  workspaces: Workspaces;
  hub: Hub;
  token: string;
  info: ServeInfo;
  /** Built web UI; may not exist in a source checkout. */
  webDir: string;
  persist: boolean;
  /** Starting point of the folder picker. */
  home: string;
  /** System folder dialog; defaults to the real one (tests inject a fake). */
  chooseFolder?: (start?: string) => Promise<string | null>;
  /** Chrome DevTools connection for the browser panel; defaults to the real one (tests inject a fake). */
  connectCdp?: (port: number) => Promise<Cdp>;
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

/** Cookies ignore ports, so the name carries it — two `tah serve` on one machine keep separate sign-ins. */
function cookieName(req: IncomingMessage): string {
  return `${COOKIE}_${req.socket.localPort}`;
}

function cookieToken(req: IncomingMessage): string {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === cookieName(req)) return value.join("=");
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

async function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Record<string, unknown>> {
  const buf = await readRaw(req, max);
  const text = buf.toString("utf8");
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

async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new HttpError(413, "request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `"${key}" must be a non-empty string`);
  return value;
}

function optStr(body: Record<string, unknown>, key: string): string | undefined {
  return body[key] === undefined ? undefined : str(body, key);
}

/** Same precedence as the openai-compatible provider in `@typescript-agent-harness/llm`. */
function envModel(): SettingsView["env"] {
  const e = process.env;
  const key = e.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : e.OPENAI_API_KEY ? "OPENAI_API_KEY" : undefined;
  if (!key) return null;
  return { model: e.DEEPSEEK_MODEL ?? e.OPENAI_MODEL ?? (e.DEEPSEEK_API_KEY ? "deepseek-chat" : "gpt-4o-mini"), key };
}

/** Request handler plus `closeAll()` to end the event streams on shutdown. */
export function createServeHandler(opts: ServeOptions): { handle: RequestListener; closeAll(): void } {
  const { workspaces, hub } = opts;
  const host = () => workspaces.host;
  const streams = new Set<ServerResponse>();
  const webDir = path.resolve(opts.webDir);
  let choosing = false;
  const previewToken = randomBytes(32).toString("base64url");
  const screen = createScreen({
    browser: () => host().browser,
    ...(opts.connectCdp ? { connect: opts.connectCdp } : {}),
  });
  // The agent's browser tools and folder switches change the browser behind the panel.
  const unsubscribeScreen = hub.subscribe((event) => {
    if (event.type === "session" || (event.type === "tool.end" && event.tool.startsWith("browser_"))) void screen.sync();
  });

  /** The file a `/api/files/*` query names (`path=` or `attachment=<id>`), inside the open folder. */
  const fileOf = async (req: IncomingMessage) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
    const id = query.get("attachment");
    if (id !== null) {
      const ref = /^[\w-]+$/.test(id) ? createAttachmentStore(workspaces.cwd).get(id) : undefined;
      if (!ref) throw new NotInFolderError();
      return resolveInFolder(workspaces.cwd, ref.path);
    }
    const file = query.get("path");
    if (!file) throw new HttpError(400, '"path" or "attachment" is required');
    return resolveInFolder(workspaces.cwd, file);
  };

  const settingsView = (): SettingsView => {
    const s = loadSettings(opts.home);
    return {
      user: os.userInfo().username,
      models: s.models.map((m) => ({
        id: m.id,
        model: m.model,
        baseURL: m.baseURL ?? defaultBaseURL(m.model),
        keyHint: keyHint(m.apiKey),
        vision: m.vision === true,
      })),
      activeModel: s.activeModel ?? null,
      env: envModel(),
      search: s.tavilyApiKey
        ? { source: "settings", keyHint: keyHint(s.tavilyApiKey) }
        : searchKey(opts.home)
          ? { source: "env", keyHint: keyHint(searchKey(opts.home)!) }
          : null,
    };
  };
  const skillsView = (): SkillsView => ({
    skills: discoverSkills({ cwd: workspaces.cwd, homeDir: opts.home }).skills.map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source === "home" ? "home" : "folder",
      path: s.skillFile,
    })),
  });
  /** The open folder rebuilds its LLM when the active model changed; other folders read settings when opened. */
  const changeModels = async (change: () => void, res: ServerResponse) => {
    hub.assertIdle();
    const before = JSON.stringify(activeModel(opts.home));
    change();
    if (JSON.stringify(activeModel(opts.home)) !== before) await host().reload();
    return json(res, 200, settingsView());
  };

  const needPersist = () => {
    if (!opts.persist) throw new HttpError(409, "sessions are only saved with persist on (drop --no-persist)");
  };
  /** Switches folder when the body names one; true when it switched. */
  const enter = async (cwd: string | undefined): Promise<boolean> => {
    if (cwd === undefined) return false;
    needPersist();
    return workspaces.activate(cwd);
  };

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

  /** Frames a slow tab cannot take are replaced by the newest one; `state` events always go out. */
  const browserStream = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    streams.add(res);
    let blocked = false;
    let waiting: string | undefined;
    // Runs inside the browser connection's message handler, so it must not throw on an ended response.
    const send = (chunk: string) => {
      if (res.writableEnded) return;
      blocked = !res.write(chunk);
    };
    res.on("drain", () => {
      blocked = false;
      const chunk = waiting;
      waiting = undefined;
      if (chunk) send(chunk);
    });
    const unsubscribe = screen.subscribe((event) => {
      const chunk = `data: ${JSON.stringify(event)}\n\n`;
      if (event.type === "frame" && blocked) waiting = chunk;
      else {
        // A parked frame may be from the tab shown before this state.
        if (event.type === "state") waiting = undefined;
        send(chunk);
      }
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
  };

  const api = async (req: IncomingMessage, res: ServerResponse, route: string) => {
    const isUpload = req.method === "POST" && route === "/api/attachments";
    if (req.method === "POST") {
      if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, "cross-origin request");
      const ct = req.headers["content-type"] ?? "";
      if (isUpload) {
        if (!ct.startsWith("application/octet-stream")) {
          throw new HttpError(415, "content-type must be application/octet-stream");
        }
      } else if (!ct.startsWith("application/json")) {
        throw new HttpError(415, "content-type must be application/json");
      }
    }
    const authed = sameToken(cookieToken(req), opts.token);
    const key = `${req.method} ${route}`;

    if (key === "POST /api/auth") {
      if (!sameToken(str(await readBody(req), "token"), opts.token)) throw new HttpError(401, "wrong token");
      res.setHeader("set-cookie", `${cookieName(req)}=${opts.token}; HttpOnly; SameSite=Strict; Path=/`);
      return json(res, 204);
    }
    if (!authed) throw new HttpError(401, "not signed in — open the link tah serve printed");

    switch (key) {
      case "GET /api/info":
        return json(res, 200, opts.info);
      case "GET /api/events":
        return events(req, res);
      case "GET /api/sessions":
        needPersist();
        return json(res, 200, await host().listSessions());
      case "POST /api/attachments": {
        const nameHeader = req.headers["x-tah-filename"];
        const mimeHeader = req.headers["x-tah-mime"];
        const name = typeof nameHeader === "string" ? decodeURIComponent(nameHeader) : "file";
        const mime = typeof mimeHeader === "string" ? mimeHeader : "application/octet-stream";
        const data = await readRaw(req, MAX_UPLOAD);
        if (data.length === 0) throw new HttpError(400, "empty upload");
        try {
          const ref = host().saveAttachment({ name, mime, data });
          const { path: _path, ...meta } = ref;
          return json(res, 201, meta);
        } catch (err) {
          if (err instanceof AttachmentError) throw new HttpError(400, err.message);
          throw err;
        }
      }
      case "POST /api/send": {
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text : "";
        const ids = body.attachmentIds;
        const attachmentIds = Array.isArray(ids)
          ? ids.map((id, i) => {
              if (typeof id !== "string" || !id) throw new HttpError(400, `"attachmentIds[${i}]" must be a string`);
              return id;
            })
          : [];
        if (!text.trim() && attachmentIds.length === 0) throw new HttpError(400, "text or attachmentIds required");
        if (!hub.busy) {
          hub.start(() => host().send(text, attachmentIds));
          return json(res, 202);
        }
        try {
          await host().send(text, attachmentIds);
        } catch (err) {
          if (err instanceof AttachmentError) throw new HttpError(400, err.message);
          throw err;
        }
        return json(res, 202);
      }
      case "POST /api/queue": {
        const body = await readBody(req);
        const id = str(body, "id");
        if (body.remove === true) host().removeQueued(id);
        else if (body.send === true) hub.start(() => host().sendQueued(id));
        else throw new HttpError(400, 'pass "send": true or "remove": true');
        return json(res, 204);
      }
      case "POST /api/continue":
        hub.start(() => host().continueTurn());
        return json(res, 202);
      case "POST /api/compact":
        hub.start(() => host().compact());
        return json(res, 202);
      case "POST /api/cancel":
        host().cancel();
        return json(res, 204);
      case "POST /api/answer": {
        const body = await readBody(req);
        const answer = body.answer as ApprovalAnswer;
        if (!ANSWERS.includes(answer)) throw new HttpError(400, `"answer" must be one of ${ANSWERS.join(", ")}`);
        host().answer(str(body, "id"), answer);
        return json(res, 204);
      }
      case "POST /api/question": {
        const body = await readBody(req);
        if (body.skip === true) {
          host().skipQuestion(str(body, "id"));
          return json(res, 204);
        }
        const answers = body.answers;
        if (!Array.isArray(answers) || !answers.every((a) => Array.isArray(a) && a.every((s) => typeof s === "string"))) {
          throw new HttpError(400, '"answers" must be a list of string lists');
        }
        host().answerQuestion(str(body, "id"), answers as string[][]);
        return json(res, 204);
      }
      case "POST /api/reset": {
        const cwd = optStr(await readBody(req), "cwd");
        hub.assertIdle();
        // Opening a folder already lands on its latest session; reuse it when that one is still empty.
        const switched = await enter(cwd);
        if (!(switched && host().snapshot().history.length === 0)) await host().reset();
        return json(res, 204);
      }
      case "POST /api/resume": {
        const body = await readBody(req);
        const ref = str(body, "ref");
        hub.assertIdle();
        await enter(optStr(body, "cwd"));
        await host().resume(ref);
        return json(res, 204);
      }
      case "POST /api/fork": {
        const body = await readBody(req);
        const turns = body.turns;
        if (turns !== undefined && !(Number.isInteger(turns) && (turns as number) >= 0)) {
          throw new HttpError(400, '"turns" must be a non-negative integer');
        }
        const id = optStr(body, "id");
        hub.assertIdle();
        await enter(optStr(body, "cwd"));
        if (id !== undefined && id !== host().sessionId) await host().resume(id);
        await host().fork(turns as number | undefined);
        return json(res, 204);
      }
      case "POST /api/rename": {
        needPersist();
        const body = await readBody(req);
        const id = str(body, "id");
        if (typeof body.title !== "string") throw new HttpError(400, '"title" must be a string');
        hub.assertIdle();
        const title = await workspaces.renameSession(optStr(body, "cwd"), id, body.title);
        return json(res, 200, { id, title: title ?? null });
      }
      case "POST /api/session-flag": {
        needPersist();
        const body = await readBody(req);
        const id = str(body, "id");
        if (body.flag !== "pinned" && body.flag !== "archived") {
          throw new HttpError(400, '"flag" must be "pinned" or "archived"');
        }
        if (typeof body.on !== "boolean") throw new HttpError(400, '"on" must be a boolean');
        await workspaces.setSessionFlag(optStr(body, "cwd"), id, body.flag, body.on);
        return json(res, 204);
      }
      case "GET /api/workspaces":
        needPersist();
        return json(res, 200, await workspaces.list());
      case "GET /api/workspaces/recent":
        return json(res, 200, workspaces.recent());
      case "POST /api/workspaces/add":
        workspaces.add(str(await readBody(req), "path"));
        return json(res, 204);
      case "POST /api/workspaces/remove":
        workspaces.remove(str(await readBody(req), "path"));
        return json(res, 204);
      case "GET /api/files/stat": {
        const file = await fileOf(req);
        const kind = await fileKind(file.abs);
        const view: FileStat = { path: file.rel, kind, bytes: file.bytes, mtime: file.mtime };
        if (kind === "html") view.previewURL = `/preview/${previewToken}/${file.rel.split("/").map(encodeURIComponent).join("/")}`;
        return json(res, 200, view);
      }
      case "GET /api/files/raw": {
        const file = await fileOf(req);
        const kind = await fileKind(file.abs);
        return sendFile(req, res, file.abs, file.bytes, {
          "content-type": contentType(file.abs, kind),
          ...(kind === "pdf" ? {} : { "content-security-policy": "sandbox" }),
        });
      }
      case "GET /api/browser":
        return json(res, 200, screen.state());
      case "GET /api/browser/stream":
        return browserStream(req, res);
      case "POST /api/browser/open": {
        const input = optStr(await readBody(req), "url");
        const url = input === undefined ? undefined : browserURL(input, req.socket.localPort ?? 0);
        if (input !== undefined && url === undefined) {
          throw new HttpError(400, "only http(s) pages (not tah itself), about:blank or a file preview can be opened");
        }
        await screen.open(url);
        return json(res, 200, screen.state());
      }
      case "POST /api/browser/nav": {
        const action = (await readBody(req)).action;
        if (action !== "back" && action !== "reload") throw new HttpError(400, '"action" must be "back" or "reload"');
        await screen.nav(action);
        return json(res, 204);
      }
      case "POST /api/browser/tab":
        await screen.tab(str(await readBody(req), "id"));
        return json(res, 204);
      case "POST /api/browser/input":
        await screen.input(parseInput(await readBody(req)));
        return json(res, 204);
      case "POST /api/browser/dialog": {
        const body = await readBody(req);
        if (typeof body.accept !== "boolean") throw new HttpError(400, '"accept" must be a boolean');
        if (body.text !== undefined && typeof body.text !== "string") throw new HttpError(400, '"text" must be a string');
        await screen.dialog(body.accept, body.text);
        return json(res, 204);
      }
      case "POST /api/browser/close":
        await screen.close();
        return json(res, 204);
      case "GET /api/fs": {
        const dir = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("path") ?? undefined;
        return json(res, 200, listDirs(dir, opts.home));
      }
      case "POST /api/fs/mkdir": {
        const body = await readBody(req);
        return json(res, 201, { path: makeDir(str(body, "path"), str(body, "name")) });
      }
      case "GET /api/settings":
        return json(res, 200, settingsView());
      case "POST /api/settings/models": {
        const body = await readBody(req);
        const input = {
          model: str(body, "model"),
          apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
          vision: body.vision === true,
        };
        const baseURL = optStr(body, "baseURL");
        return changeModels(() => void addModel(opts.home, baseURL ? { ...input, baseURL } : input), res);
      }
      case "POST /api/settings/models/remove": {
        const id = str(await readBody(req), "id");
        return changeModels(() => removeModel(opts.home, id), res);
      }
      case "POST /api/settings/models/vision": {
        const body = await readBody(req);
        const id = str(body, "id");
        if (typeof body.vision !== "boolean") throw new HttpError(400, '"vision" must be a boolean');
        const vision = body.vision;
        return changeModels(() => setModelVision(opts.home, id, vision), res);
      }
      case "POST /api/settings/active": {
        const body = await readBody(req);
        if (body.id !== null && typeof body.id !== "string") throw new HttpError(400, '"id" must be a string or null');
        const id = body.id;
        return changeModels(() => setActiveModel(opts.home, id), res);
      }
      case "POST /api/settings/search": {
        const body = await readBody(req);
        if (body.apiKey !== null && typeof body.apiKey !== "string") throw new HttpError(400, '"apiKey" must be a string or null');
        hub.assertIdle();
        setSearchKey(opts.home, body.apiKey);
        await host().reload();
        return json(res, 200, settingsView());
      }
      case "GET /api/skills":
        return json(res, 200, skillsView());
      case "POST /api/skills/import": {
        const from = str(await readBody(req), "path");
        hub.assertIdle();
        const result = importSkills(opts.home, from);
        if (result.imported.length) await host().reload();
        return json(res, 200, { ...skillsView(), ...result });
      }
      case "POST /api/skills/remove": {
        const name = str(await readBody(req), "name");
        hub.assertIdle();
        removeSkill(opts.home, name);
        await host().reload();
        return json(res, 200, skillsView());
      }
      case "POST /api/fs/choose": {
        const start = optStr(await readBody(req), "start");
        if (choosing) throw new HttpError(409, "a folder dialog is already open");
        choosing = true;
        try {
          return json(res, 200, { path: await (opts.chooseFolder ?? chooseFolder)(start) });
        } finally {
          choosing = false;
        }
      }
    }
    throw new HttpError(404, `no such endpoint: ${key}`);
  };

  const preview = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method not allowed");
    const [, , token = "", ...rest] = pathname.split("/");
    if (!sameToken(token, previewToken)) throw new NotInFolderError();
    const file = await resolveInFolder(workspaces.cwd, rest.join("/"));
    const kind = await fileKind(file.abs);
    sendFile(req, res, file.abs, file.bytes, {
      "content-type": contentType(file.abs, kind),
      "content-security-policy": PREVIEW_CSP,
    });
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
          : pathname.startsWith("/preview/")
            ? preview(req, res, pathname)
            : page(req, res, pathname);
    work.catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      if (err instanceof NotInFolderError) return json(res, 404, { error: err.message });
      if (err instanceof BusyError) return json(res, 409, { error: err.message });
      if (err instanceof AttachmentError) return json(res, 400, { error: err.message });
      if (err instanceof ConflictError) return json(res, 409, { error: err.message });
      if (err instanceof UnsupportedError) return json(res, 501, { error: err.message });
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  };

  return {
    handle,
    closeAll() {
      unsubscribeScreen();
      screen.dispose();
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
