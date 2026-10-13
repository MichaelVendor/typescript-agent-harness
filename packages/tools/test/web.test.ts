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
