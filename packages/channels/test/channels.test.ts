import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  createMockChannel,
  feishuThreadId,
  ingestFeishuPayload,
  ingestSlackPayload,
  parseTelegramUpdates,
  slackThreadId,
  telegramThreadId,
  toSuperAgentEvent,
  verifySlackSignature,
} from "../dist/index.js";

test("toSuperAgentEvent: new thread → user_message", () => {
  const ev = toSuperAgentEvent({
    source: "telegram",
    threadId: "tg:chat/1",
    text: "修 bug",
    isNewThread: true,
    replyTo: { kind: "telegram", chatId: 1 },
  });
  assert.deepEqual(ev, { kind: "user_message", text: "修 bug", channel: "telegram" });
});

test("toSuperAgentEvent: follow-up → source_event", () => {
  const ev = toSuperAgentEvent({
    source: "slack",
    threadId: slackThreadId("T", "C", "1.2"),
    text: "补测",
    isNewThread: false,
    replyTo: { kind: "slack", channel: "C", threadTs: "1.2" },
  });
  assert.equal(ev.kind, "source_event");
  if (ev.kind === "source_event") {
    assert.equal(ev.threadId, "slack:T:C:1.2");
    assert.equal(ev.source, "slack");
  }
});

test("mock channel push + send", async () => {
  const mock = createMockChannel();
  const seen: string[] = [];
  await mock.start({
    onMessage(msg) {
      seen.push(msg.text);
    },
  });
  mock.push({
    source: "mock",
    threadId: "mock:1",
    text: "hello",
    isNewThread: true,
    replyTo: { kind: "mock", id: "1" },
  });
  await mock.send({ kind: "mock", id: "1" }, "DONE");
  assert.deepEqual(seen, ["hello"]);
  assert.equal(mock.sent[0]?.text, "DONE");
  await mock.stop();
});

test("telegram fixture parse", () => {
  const msgs: { threadId: string; isNewThread: boolean }[] = [];
  parseTelegramUpdates(
    [
      {
        update_id: 1,
        message: {
          message_id: 10,
          text: "hi",
          chat: { id: 42, type: "private" },
        },
      },
      {
        update_id: 2,
        message: {
          message_id: 11,
          text: "topic reply",
          chat: { id: 99, type: "supergroup" },
          message_thread_id: 7,
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        },
      },
    ],
    (m) => msgs.push({ threadId: m.threadId, isNewThread: m.isNewThread }),
  );
  assert.equal(msgs[0]?.threadId, telegramThreadId(42));
  assert.equal(msgs[0]?.isNewThread, true);
  assert.equal(msgs[1]?.threadId, telegramThreadId(99, 7));
  assert.equal(msgs[1]?.isNewThread, false);
});

test("slack signature + ingest mention", () => {
  const secret = "sig-secret";
  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event: {
      type: "app_mention",
      text: "<@Ubot> 修登录",
      channel: "C1",
      ts: "100.1",
    },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  assert.equal(verifySlackSignature(secret, body, ts, sig), true);
  assert.equal(verifySlackSignature(secret, body, ts, "v0=dead"), false);

  const seen: { text: string; isNewThread: boolean }[] = [];
  ingestSlackPayload(JSON.parse(body), (m) => seen.push({ text: m.text, isNewThread: m.isNewThread }));
  assert.equal(seen[0]?.text, "修登录");
  assert.equal(seen[0]?.isNewThread, true);
});

test("feishu challenge shape + message ingest", () => {
  const seen: { threadId: string; text: string }[] = [];
  ingestFeishuPayload(
    {
      token: "test-token",
      event: {
        message: {
          chat_id: "oc_1",
          message_id: "om_1",
          message_type: "text",
          content: JSON.stringify({ text: "查库存" }),
          chat_type: "p2p",
        },
      },
    },
    (m) => seen.push({ threadId: m.threadId, text: m.text }),
  );
  assert.equal(seen[0]?.threadId, feishuThreadId("oc_1", "om_1"));
  assert.equal(seen[0]?.text, "查库存");
});
