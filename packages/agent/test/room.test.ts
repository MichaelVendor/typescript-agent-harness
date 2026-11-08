import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createRoom,
  matchesMessageSubsequence,
  visibleMessagesFor,
  type TurnRunner,
} from "../src/room.ts";

const members = [
  { id: "tl" as const, displayName: "运营 TL", persona: "你负责拆任务并收口" },
  { id: "compliance", displayName: "合规", persona: "你只谈合规风险" },
];

function scriptedRunner(): TurnRunner {
  let tlPasses = 0;
  return async ({ member, visible }) => {
    if (member.id === "tl") {
      tlPasses += 1;
      if (tlPasses === 1) {
        return {
          kind: "delegate",
          text: "请核查 B0XXX 德国站合规风险，缺数据写缺口。",
          mention: ["compliance"],
        };
      }
      return {
        kind: "status",
        text: "DONE\n综合：建议观察，暂不上架。",
        done: true,
      };
    }
    if (member.id === "compliance") {
      const leaked = visible.some((m) => m.visibility?.mode === "tl_only");
      assert.equal(leaked, false, "compliance 不应看见 tl_only");
      return {
        kind: "result",
        text: "风险：认证缺失；建议观察。",
        traceHint: { tools: ["compliance_check"], ok: true },
      };
    }
    return { kind: "chat", text: "noop" };
  };
}

test("三回合：user → tl delegate → compliance result → tl done", async () => {
  const room = createRoom({
    goal: "评估 B0XXX 上架德国站合规",
    members,
    turnRunner: scriptedRunner(),
  });
  room.post({
    from: "user",
    kind: "chat",
    text: "目标：评估 ASIN B0XXX 上架德国站的合规风险，给出是否建议上架。",
  });
  assert.equal(room.meta.status, "tl_thinking");

  await room.step();
  assert.equal(room.meta.status, "member_running");
  assert.equal(room.meta.activeMember, "compliance");

  await room.step();
  assert.equal(room.meta.status, "tl_thinking");

  await room.step();
  assert.equal(room.meta.status, "done");

  assert.ok(
    matchesMessageSubsequence(room.transcript(), [
      { from: "user", kind: "chat" },
      { from: "tl", kind: "delegate" },
      { from: "compliance", kind: "result" },
      { from: "tl", kind: "status" },
    ]),
  );
  const status = room.transcript().filter((m) => m.kind === "status").at(-1);
  assert.equal(status?.done, true);
});

test("tl_only 对成员不可见，对 tl 可见", () => {
  const messages = [
    {
      id: "1",
      at: "t",
      roomId: "r",
      from: "tl" as const,
      kind: "chat" as const,
      text: "内部草稿",
      visibility: { mode: "tl_only" as const },
    },
    {
      id: "2",
      at: "t",
      roomId: "r",
      from: "user" as const,
      kind: "chat" as const,
      text: "目标",
    },
  ];
  assert.equal(visibleMessagesFor("compliance", messages).length, 1);
  assert.equal(visibleMessagesFor("tl", messages).length, 2);
});

test("member_running 时用户消息入队，result 后才进 transcript", async () => {
  const room = createRoom({
    goal: "g",
    members,
    turnRunner: scriptedRunner(),
  });
  room.post({ from: "user", kind: "chat", text: "开场" });
  await room.step(); // tl delegate → member_running

  const queued = room.post({ from: "user", kind: "chat", text: "插一句" });
  assert.deepEqual(queued, { queued: true });
  assert.ok(!room.transcript().some((m) => m.text === "插一句"));

  await room.step(); // compliance result → tl_thinking + drain
  assert.ok(room.transcript().some((m) => m.text === "插一句"));
  assert.equal(room.meta.status, "tl_thinking");
});

test("persistDir 写入 transcript.jsonl 与 meta.json", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-room-"));
  const room = createRoom({
    goal: "g",
    members,
    persistDir: dir,
    turnRunner: scriptedRunner(),
  });
  room.post({ from: "user", kind: "chat", text: "开场" });
  await room.step();
  const lines = readFileSync(path.join(dir, "transcript.jsonl"), "utf8").trim().split("\n");
  assert.ok(lines.length >= 2);
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as { status: string };
  assert.equal(meta.status, "member_running");
});
