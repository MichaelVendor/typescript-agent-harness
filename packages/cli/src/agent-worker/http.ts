import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { ApprovalAnswer } from "@typescript-agent-harness/permissions";
import { writeHostEvent } from "../agent-host/sse.js";
import { AttachmentError } from "../attachments/store.js";
import type { ChatHost, HostEvent } from "../host.js";
import { checkWorkerBearer } from "./auth.js";

export type AgentWorkerHandlerOptions = {
  token: string;
  host: ChatHost;
};

const MAX_BODY = 1_000_000;
const HEARTBEAT_MS = 15_000;
const ANSWERS: ApprovalAnswer[] = ["yes", "always", "no"];

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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
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

export function createAgentWorkerHandler(opts: AgentWorkerHandlerOptions): RequestListener {
  const { host } = opts;
  let busy = false;
  host.on((event: HostEvent) => {
    if (event.type === "user") busy = true;
    else if (event.type === "turn.end" || event.type === "turn.error") busy = false;
  });

  /** Starts a turn without waiting for it; the result goes out over `/events`. */
  const start = (run: () => Promise<void>) => {
    busy = true;
    run().catch(() => {
      busy = false;
    });
  };

  const events = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    const unsubscribe = host.on((event) => {
      if (!res.writableEnded) writeHostEvent(res, event);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const route = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const key = `${req.method} ${route}`;
    if (key === "GET /health") return json(res, 200, { ok: true });
    if (!checkWorkerBearer(req.headers.authorization, opts.token)) throw new HttpError(401, "missing or invalid token");

    switch (key) {
      case "GET /session":
        return json(res, 200, host.snapshot());
      case "GET /events":
        return events(req, res);
      case "POST /send": {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text : "";
        const ids = body.attachmentIds;
        const attachmentIds = Array.isArray(ids)
          ? ids.map((id, i) => {
              if (typeof id !== "string" || !id) throw new HttpError(400, `"attachmentIds[${i}]" must be a string`);
              return id;
            })
          : [];
        if (!text.trim() && attachmentIds.length === 0) throw new HttpError(400, "text or attachmentIds required");
        if (!busy) {
          start(() => host.send(text, attachmentIds));
          return json(res, 202);
        }
        try {
          await host.send(text, attachmentIds);
        } catch (err) {
          if (err instanceof AttachmentError) throw new HttpError(400, err.message);
          throw err;
        }
        return json(res, 202);
      }
      case "POST /cancel":
        host.cancel();
        return json(res, 204);
      case "POST /answer": {
        const body = await readJson(req);
        const answer = body.answer as ApprovalAnswer;
        if (!ANSWERS.includes(answer)) throw new HttpError(400, `"answer" must be one of ${ANSWERS.join(", ")}`);
        host.answer(str(body, "id"), answer);
        return json(res, 204);
      }
      case "POST /question": {
        const body = await readJson(req);
        if (body.skip === true) {
          host.skipQuestion(str(body, "id"));
          return json(res, 204);
        }
        const answers = body.answers;
        if (!Array.isArray(answers) || !answers.every((a) => Array.isArray(a) && a.every((s) => typeof s === "string"))) {
          throw new HttpError(400, '"answers" must be a list of string lists');
        }
        host.answerQuestion(str(body, "id"), answers as string[][]);
        return json(res, 204);
      }
      case "POST /continue":
        start(() => host.continueTurn());
        return json(res, 202);
      case "POST /compact":
        start(() => host.compact());
        return json(res, 202);
      case "POST /queue": {
        const body = await readJson(req);
        const id = str(body, "id");
        if (body.remove === true) host.removeQueued(id);
        else if (body.send === true) start(() => host.sendQueued(id));
        else throw new HttpError(400, 'pass "send": true or "remove": true');
        return json(res, 204);
      }
      default:
        return json(res, 404, { error: "not found" });
    }
  };

  return (req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
