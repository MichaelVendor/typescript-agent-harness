import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { notifyBrief } from "./notify.ts";

describe("notifyBrief", () => {
  it("no-ops when BRIEF_NOTIFY empty", async () => {
    const calls: string[] = [];
    const out = await notifyBrief(
      { subscriptionId: "s1", markdown: "### 结论\nok\n" },
      {
        env: {},
        fetchImpl: async (url) => {
          calls.push(String(url));
          return new Response("{}", { status: 200 });
        },
      },
    );
    assert.deepEqual(out, []);
    assert.deepEqual(calls, []);
  });

  it("posts telegram and feishu when configured", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const out = await notifyBrief(
      {
        subscriptionId: "s1",
        markdown: "### 结论\nok\n",
        mdPath: "/tmp/a.md",
      },
      {
        env: {
          BRIEF_NOTIFY: "telegram,feishu",
          TELEGRAM_BOT_TOKEN: "tok",
          BRIEF_TG_CHAT_ID: "123",
          BRIEF_FEISHU_WEBHOOK: "https://example.com/hook",
        },
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), body: String(init?.body ?? "") });
          return new Response("{}", { status: 200 });
        },
      },
    );
    assert.equal(out.length, 2);
    assert.equal(out.every((r) => r.ok), true);
    assert.ok(calls[0]?.url.includes("api.telegram.org"));
    assert.equal(calls[1]?.url, "https://example.com/hook");
    assert.ok(calls[0]?.body.includes("s1"));
  });

  it("records failure when secrets missing", async () => {
    const out = await notifyBrief(
      { subscriptionId: "s1", markdown: "x" },
      {
        env: { BRIEF_NOTIFY: "telegram" },
        fetchImpl: async () => new Response("{}", { status: 200 }),
      },
    );
    assert.equal(out[0]?.ok, false);
    assert.match(out[0]?.detail ?? "", /missing/);
  });
});
