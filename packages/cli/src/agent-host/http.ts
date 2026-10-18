import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

export type AgentHostHandlerOptions = {
  secret: string;
  projectId: string;
};

function json(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

export function createAgentHostHandler(opts: AgentHostHandlerOptions): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.method === "GET" && pathname === "/health") {
      return json(res, 200, { ok: true, projectId: opts.projectId });
    }
    return json(res, 404, { error: "not found" });
  };
}
