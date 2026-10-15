import { lookup } from "node:dns/promises";
import net from "node:net";
import type { Tool } from "./types.js";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHARS = 30_000;
const MAX_CHARS = 100_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; tah/1.0; +https://github.com/MichaelVendor/typescript-agent-harness)";

function privateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIPv4(mapped[1]!);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** Pages can steer the model, so it must not reach this machine or the local network (e.g. `tah serve`, cloud metadata). */
async function assertPublic(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.some(privateAddress)) throw new Error(`${host} is a local or private address`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Readable text from HTML: headings, list items and links survive as Markdown, everything else becomes plain lines. */
export function htmlToText(html: string, base: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      let target: string;
      try {
        target = new URL(decodeEntities(href), base).href;
      } catch {
        return text;
      }
      return text && /^https?:/.test(target) ? `[${text}](${target})` : text;
    })
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|tr|table|ul|ol|pre|blockquote|h[1-6]|dl|dt|dd|figure)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const cleanTitle = title ? decodeEntities(title).replace(/\s+/g, " ").trim() : undefined;
  return cleanTitle ? { title: cleanTitle, text: s } : { text: s };
}

async function readCapped(res: Response): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), cut: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      cut = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, bytes.byteLength - at);
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes, cut };
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export type WebFetchOptions = {
  /** Tests fetch from a local server; never set this for a real agent. */
  allowPrivate?: boolean;
};

export function webFetchTool(
  options: WebFetchOptions = {},
): Tool<{ url: string; max_chars?: number }, { url: string; status: number; title?: string; content: string; truncated: boolean }> {
  return {
    name: "web_fetch",
    description:
      "Fetch a public web page (http/https) and return its readable text, with links as Markdown. Use it to read a URL from the user or from web_search results. Not for local or private addresses.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
        max_chars: { type: "number", description: `Characters of text to return, default ${DEFAULT_CHARS}, at most ${MAX_CHARS}` },
      },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      let url: URL;
      try {
        url = new URL(input.url);
      } catch {
        throw new Error(`invalid URL: ${input.url}`);
      }
      const limit = Math.min(Math.max(1, Math.floor(input.max_chars ?? DEFAULT_CHARS)), MAX_CHARS);
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]);

      let res: Response | undefined;
      for (let hop = 0; ; hop += 1) {
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`only http and https URLs: ${url.href}`);
        if (!options.allowPrivate) await assertPublic(url);
        res = await fetch(url, {
          redirect: "manual",
          signal,
          headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5" },
        });
        const location = res.headers.get("location");
        if (res.status < 300 || res.status >= 400 || !location) break;
        if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects from ${input.url}`);
        await res.body?.cancel();
        url = new URL(location, url);
      }
      if (res.status >= 400) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.href}`.trim());
      }
      const type = res.headers.get("content-type") ?? "";
      const textual = !type || /^text\/|json|xml|javascript/i.test(type);
      if (!textual) {
        await res.body?.cancel();
        throw new Error(`not a text page (${type.split(";")[0]}): ${url.href}`);
      }
      const { bytes, cut } = await readCapped(res);
      const raw = decode(bytes, type);
      const page = /html/i.test(type) || (!type && /<html[\s>]/i.test(raw)) ? htmlToText(raw, url.href) : { text: raw.trim() };
      return {
        url: url.href,
        status: res.status,
        ...(page.title ? { title: page.title } : {}),
        content: page.text.slice(0, limit),
        truncated: cut || page.text.length > limit,
      };
    },
  };
}

export type WebSearchResult = { title: string; url: string; content: string };

export type WebSearchOptions = {
  /** Tavily key; without one the tool uses Exa's keyless endpoint, then Bing. */
  apiKey?: string;
  /** Tests point these at local servers. */
  endpoint?: string;
  exaEndpoint?: string;
  bingEndpoint?: string;
};

const EXCERPT_CHARS = 1000;
const EXA_TIMEOUT_MS = 10_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function searchTavily(endpoint: string, apiKey: string, query: string, max: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: max, search_depth: "basic", include_answer: false }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { detail?: { error?: string } | string };
      detail = typeof body.detail === "string" ? body.detail : (body.detail?.error ?? detail);
    } catch {}
    throw new Error(`web search failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = JSON.parse(text) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (body.results ?? [])
    .filter((r) => typeof r.url === "string")
    .map((r) => ({ title: r.title ?? "", url: r.url!, content: (r.content ?? "").slice(0, EXCERPT_CHARS) }));
}

type ExaReply = {
  error?: { message?: string };
  result?: { isError?: boolean; _meta?: Record<string, unknown>; content?: Array<{ type?: string; text?: string }> };
};

/** Exa's hosted MCP server; it answers one JSON-RPC call as JSON or as a server-sent event. */
async function searchExa(endpoint: string, query: string, max: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(EXA_TIMEOUT_MS)]),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa", arguments: { query, numResults: max } } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  const reply = JSON.parse(data.length ? data.at(-1)! : text) as ExaReply;
  if (reply.error) throw new Error(reply.error.message ?? "error");
  const body = reply.result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  if (reply.result?._meta?.["ai.exa/rateLimited"]) throw new Error("rate limited");
  if (reply.result?.isError) throw new Error(body.slice(0, 200) || "error");
  return body
    .split(/\n\n---\n\n/)
    .flatMap((block) => {
      const url = block.match(/^URL:\s*(\S+)/m)?.[1];
      if (!url || !/^https?:\/\//.test(url)) return [];
      const title = block.match(/^Title:\s*(.*)$/m)?.[1]?.trim() ?? "";
      const highlights = block.indexOf("Highlights:");
      const content = highlights >= 0 ? block.slice(highlights + "Highlights:".length) : block.replace(/^(Title|URL|Published Date|Author):.*$/gm, "");
      return [{ title, url, content: content.trim().slice(0, EXCERPT_CHARS) }];
    })
    .slice(0, max);
}

const inlineText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Bing wraps result links as `bing.com/ck/a?…&u=a1<base64url>`; anything that is not http(s) is dropped. */
function bingTarget(href: string): string | undefined {
  let url = decodeEntities(href);
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("bing.com") && parsed.pathname === "/ck/a") {
      const u = parsed.searchParams.get("u");
      if (!u?.startsWith("a1")) return undefined;
      url = Buffer.from(u.slice(2), "base64url").toString("utf8");
    }
    return /^https?:$/.test(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

async function searchBing(endpoint: string, query: string, max: number, signal: AbortSignal): Promise<WebSearchResult[]> {
  const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}&count=${max}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    headers: { "user-agent": BROWSER_UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", accept: "text/html" },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }
  const html = await res.text();
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const item of html.split(/<li class="b_algo"/).slice(1)) {
    const link = item.match(/<h2\b[^>]*>\s*<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    const url = link && bingTarget(link[1]!);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const caption = item.match(/class="b_caption"[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/) ?? item.match(/<p\b[^>]*>([\s\S]*?)<\/p>/);
    results.push({ title: inlineText(link[2]!), url, content: inlineText(caption?.[1] ?? "").slice(0, EXCERPT_CHARS) });
    if (results.length >= max) break;
  }
  return results;
}

export function webSearchTool(
  options: WebSearchOptions = {},
): Tool<{ query: string; max_results?: number }, { query: string; engine: "tavily" | "exa" | "bing"; results: WebSearchResult[] }> {
  const endpoint = options.endpoint ?? "https://api.tavily.com/search";
  const exaEndpoint = options.exaEndpoint ?? "https://mcp.exa.ai/mcp";
  const bingEndpoint = options.bingEndpoint ?? "https://www.bing.com/search";
  return {
    name: "web_search",
    description:
      "Search the web for current information. Returns titles, URLs and short excerpts; read a page in full with web_fetch. Cite the URLs you use.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "1–10, default 5" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query || query.length > 400) throw new Error("query must be 1–400 characters");
      const max = Math.min(Math.max(1, Math.floor(input.max_results ?? 5)), 10);
      if (options.apiKey) {
        return { query, engine: "tavily", results: await searchTavily(endpoint, options.apiKey, query, max, ctx.signal) };
      }
      const reasons: string[] = [];
      for (const [engine, search] of [
        ["exa", () => searchExa(exaEndpoint, query, max, ctx.signal)],
        ["bing", () => searchBing(bingEndpoint, query, max, ctx.signal)],
      ] as const) {
        try {
          const results = await search();
          if (results.length) return { query, engine, results };
          reasons.push(`${engine}: no results`);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          reasons.push(`${engine}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      throw new Error(
        `web search failed (${reasons.join("; ")}) — try browser_open https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      );
    },
  };
}
