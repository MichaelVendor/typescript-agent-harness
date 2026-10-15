import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { htmlToText, webFetchTool, webSearchTool, type ToolContext } from "@typescript-agent-harness/tools";

const ctx = { sessionId: "s", callId: "c", signal: new AbortController().signal } as ToolContext;

async function serve(handler: http.RequestListener): Promise<{ base: string; close(): void }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const PAGE = `<html><head><title>Docs &amp; more</title><style>p{}</style></head><body>
<script>alert(1)</script><nav><a href="/next">Next&nbsp;page</a></nav>
<h2>Install</h2><p>Run   <code>npm i</code>&#33;</p><ul><li>one</li><li>two</li></ul></body></html>`;

test("htmlToText keeps headings, lists and absolute links; drops scripts and styles", () => {
  assert.deepEqual(htmlToText(PAGE, "https://example.com/a/"), {
    title: "Docs & more",
    text: "[Next page](https://example.com/next)\n\n## Install\n\nRun npm i!\n\n- one\n- two",
  });
});

test("web_fetch follows redirects, returns readable text, and reports HTTP errors and binary pages", async () => {
  const site = await serve((req, res) => {
    if (req.url === "/old") return void res.writeHead(301, { location: "/page" }).end();
    if (req.url === "/page") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
    if (req.url === "/img") return void res.writeHead(200, { "content-type": "image/png" }).end("x");
    res.writeHead(404).end("nope");
  });
  try {
    const tool = webFetchTool({ allowPrivate: true });
    const page = await tool.execute({ url: `${site.base}/old`, max_chars: 12 }, ctx);
    assert.equal(page.url, `${site.base}/page`);
    assert.equal(page.title, "Docs & more");
    assert.equal(page.content, `[Next page](`);
    assert.equal(page.truncated, true);
    await assert.rejects(tool.execute({ url: `${site.base}/gone` }, ctx), /HTTP 404/);
    await assert.rejects(tool.execute({ url: `${site.base}/img` }, ctx), /not a text page \(image\/png\)/);
    await assert.rejects(tool.execute({ url: "file:///etc/passwd" }, ctx), /only http and https/);
  } finally {
    site.close();
  }
});

test("web_fetch refuses this machine and private networks by default", async () => {
  const tool = webFetchTool();
  for (const url of ["http://127.0.0.1:1/", "http://localhost/", "http://[::1]/", "http://192.168.1.1/", "http://169.254.169.254/latest"]) {
    await assert.rejects(tool.execute({ url }, ctx), /local or private address/, url);
  }
});

test("web_search posts to Tavily with the key and maps results; errors carry the reason", async () => {
  let seen: { auth?: string; body?: unknown } = {};
  const api = await serve((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(body) };
      if (req.headers.authorization !== "Bearer tvly-good") {
        return void res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ detail: { error: "Unauthorized: missing or invalid API key." } }));
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ results: [{ title: "T", url: "https://t.example", content: "c".repeat(1500), score: 0.9 }, { title: "no url" }] }),
      );
    });
  });
  try {
    const out = await webSearchTool({ apiKey: "tvly-good", endpoint: api.base }).execute({ query: " tah ", max_results: 50 }, ctx);
    assert.deepEqual(seen, {
      auth: "Bearer tvly-good",
      body: { query: "tah", max_results: 10, search_depth: "basic", include_answer: false },
    });
    assert.equal(out.results.length, 1);
    assert.deepEqual({ ...out.results[0], content: out.results[0]!.content.length }, { title: "T", url: "https://t.example", content: 1000 });
    await assert.rejects(
      webSearchTool({ apiKey: "bad", endpoint: api.base }).execute({ query: "x" }, ctx),
      /HTTP 401 — Unauthorized: missing or invalid API key\./,
    );
    await assert.rejects(webSearchTool({ apiKey: "k", endpoint: api.base }).execute({ query: " " }, ctx), /1–400/);
  } finally {
    api.close();
  }
});

const EXA_TEXT = [
  "Title: First hit\nURL: https://a.example/one\nPublished Date: 2026-01-01\nHighlights:\n" + "a".repeat(1500),
  "Title: Second hit\nURL: https://b.example/two\nHighlights:\nshort excerpt",
].join("\n\n---\n\n");

const sse = (body: unknown) => `event: message\ndata: ${JSON.stringify(body)}\n\n`;

const ck = (url: string) => `https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${Buffer.from(url).toString("base64url")}&amp;ntb=1`;
const BING = `<html><body><ol id="b_results">
<li class="b_algo" data-id><h2><a target="_blank" href="${ck("https://c.example/中文")}"><strong>天气</strong> &amp; more</a></h2><div class="b_caption"><p class="b_lineclamp2">今天&nbsp;晴</p></div></li>
<li class="b_algo"><h2><a href="${ck("https://c.example/中文")}">dup</a></h2><p>dup</p></li>
<li class="b_algo"><h2><a href="${ck("javascript:alert(1)")}">bad</a></h2><p>bad</p></li>
<li class="b_algo"><h2><a href="https://d.example/plain">Plain link</a></h2><div class="b_caption"><p>plain text</p></div></li>
</ol></body></html>`;

async function engines(exa: http.RequestListener, bing: http.RequestListener) {
  const hits = { exa: [] as unknown[], bing: [] as string[] };
  const e = await serve((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.exa.push(JSON.parse(body));
      exa(req, res);
    });
  });
  const b = await serve((req, res) => {
    hits.bing.push(req.url ?? "");
    bing(req, res);
  });
  return {
    hits,
    tool: webSearchTool({ exaEndpoint: e.base, bingEndpoint: `${b.base}/search` }),
    close() {
      e.close();
      b.close();
    },
  };
}

test("web_search without a key uses Exa: SSE response, results mapped, excerpts capped", async () => {
  const s = await engines(
    (_req, res) => res.writeHead(200, { "content-type": "text/event-stream" }).end(sse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: EXA_TEXT }] } })),
    (_req, res) => res.writeHead(500).end(),
  );
  try {
    const out = await s.tool.execute({ query: " tah ", max_results: 50 }, ctx);
    assert.equal(out.engine, "exa");
    assert.deepEqual(
      out.results.map((r) => ({ ...r, content: r.content.length > 100 ? r.content.length : r.content })),
      [
        { title: "First hit", url: "https://a.example/one", content: 1000 },
        { title: "Second hit", url: "https://b.example/two", content: "short excerpt" },
      ],
    );
    assert.deepEqual(s.hits.exa, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa", arguments: { query: "tah", numResults: 10 } } },
    ]);
    assert.deepEqual(s.hits.bing, []);
  } finally {
    s.close();
  }
});

test("web_search falls back to Bing when Exa errors, is rate limited or returns nothing", async () => {
  const replies: http.RequestListener[] = [
    (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "boom" }] } })),
    (_req, res) => res.writeHead(500).end("down"),
    (_req, res) =>
      res.writeHead(200, { "content-type": "text/event-stream" }).end(
        sse({ jsonrpc: "2.0", id: 1, result: { _meta: { "ai.exa/rateLimited": true }, content: [{ type: "text", text: "You've hit Exa's free MCP rate limit." }] } }),
      ),
    (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "" }] } })),
  ];
  let n = 0;
  const s = await engines(
    (req, res) => replies[n++]!(req, res),
    (_req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(BING),
  );
  try {
    for (let i = 0; i < replies.length; i++) {
      const out = await s.tool.execute({ query: "天气", max_results: 5 }, ctx);
      assert.equal(out.engine, "bing");
      assert.deepEqual(out.results, [
        { title: "天气 & more", url: "https://c.example/中文", content: "今天 晴" },
        { title: "Plain link", url: "https://d.example/plain", content: "plain text" },
      ]);
    }
    assert.deepEqual(s.hits.bing[0], `/search?q=${encodeURIComponent("天气")}&count=5`);
  } finally {
    s.close();
  }
});

test("web_search reports both engines' reasons and suggests browser_open when neither works", async () => {
  const s = await engines(
    (_req, res) => res.writeHead(503).end(),
    (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html><body>captcha</body></html>"),
  );
  try {
    await assert.rejects(
      s.tool.execute({ query: "a b" }, ctx),
      (err: Error) =>
        /exa: HTTP 503/.test(err.message) && /bing: no results/.test(err.message) && err.message.includes("browser_open https://www.bing.com/search?q=a%20b"),
    );
  } finally {
    s.close();
  }
});

test("web_search with a Tavily key never calls Exa or Bing", async () => {
  const s = await engines((_req, res) => res.writeHead(500).end(), (_req, res) => res.writeHead(500).end());
  const tavily = await serve((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results: [{ title: "T", url: "https://t.example", content: "c" }] })));
  try {
    const tool = webSearchTool({ apiKey: "tvly", endpoint: tavily.base, exaEndpoint: "http://127.0.0.1:1", bingEndpoint: "http://127.0.0.1:1" });
    const out = await tool.execute({ query: "x" }, ctx);
    assert.equal(out.engine, "tavily");
    assert.equal(out.results.length, 1);
    assert.deepEqual(s.hits, { exa: [], bing: [] });
  } finally {
    s.close();
    tavily.close();
  }
});
