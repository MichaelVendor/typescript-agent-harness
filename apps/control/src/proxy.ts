import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { signAgentHostToken } from "@typescript-agent-harness/cli";

export type ProxyAgentOptions = {
  baseUrl: string;
  secret: string;
  projectId: string;
  userId: string;
  suffix: string;
};

function sendsBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

export async function proxyAgent(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProxyAgentOptions,
): Promise<number> {
  const token = signAgentHostToken(opts.secret, {
    projectId: opts.projectId,
    userId: opts.userId,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  const method = req.method ?? "GET";
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const contentType = req.headers["content-type"];
  if (contentType) headers["content-type"] = contentType;

  const base = opts.baseUrl.replace(/\/$/, "");
  const suffix = opts.suffix.startsWith("/") ? opts.suffix : `/${opts.suffix}`;
  const withBody = sendsBody(method);
  const upstream = await fetch(
    `${base}${suffix}`,
    withBody
      ? { method, headers, body: Readable.toWeb(req), duplex: "half", redirect: "manual" }
      : { method, headers, redirect: "manual" },
  );

  const out: Record<string, string> = {};
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) out["content-type"] = upstreamType;
  const cache = upstream.headers.get("cache-control");
  if (cache) out["cache-control"] = cache;
  res.writeHead(upstream.status, out);
  try {
    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      res.end();
    }
  } catch {
    if (!res.writableEnded) res.destroy();
  }
  return upstream.status;
}
