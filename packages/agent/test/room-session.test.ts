import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMRequest, type LLMResponse, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";
import { createRoom, matchesMessageSubsequence } from "../src/room.ts";
import {
  buildRoomTurnPrompt,
  createSessionTurnRunner,
  parseTurnOutput,
} from "../src/room-session.ts";

test("parseTurnOutput 接受裸 JSON 与 fence", () => {
  assert.equal(parseTurnOutput('{"kind":"result","text":"ok"}').kind, "result");
  assert.equal(
    parseTurnOutput('```json\n{"kind":"status","text":"DONE","done":true}\n```').done,
    true,
  );
  assert.throws(() => parseTurnOutput('{"kind":"delegate","text":"x"}'), /mention/);
});

function lastUserText(request: LLMRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const m = request.messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

test("createSessionTurnRunner 经真 Session.run 跑完三回合", async () => {
  let tlPasses = 0;
  const llm: LLMService = {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      const user = lastUserText(request);
      const content = (() => {
        if (user.includes('member "compliance"')) {
          return JSON.stringify({
            kind: "result",
            text: "风险：认证缺失；建议观察。",
          });
        }
        tlPasses += 1;
        if (tlPasses === 1) {
          return JSON.stringify({
            kind: "delegate",
            text: "请核查合规",
            mention: ["compliance"],
          });
        }
        return JSON.stringify({
          kind: "status",
          text: "DONE\n观察",
          done: true,
        });
      })();
      return {
        id: "r",
        model: "stub",
        message: { role: "assistant", content },
        finishReason: "stop",
      };
    },
    async *stream(request) {
      const response = await llm.generate(request);
      yield { type: "text-delta", text: response.message.content ?? "" };
      yield { type: "done", response };
    },
  };

  const runtime = new Runtime({ id: "room-session" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, llm) })
    .use(toolsPlugin())
    .use(agentPlugin({ maxSteps: 4 }));
  await runtime.start();

  const room = createRoom({
    goal: "合规快审",
    members: [
      { id: "tl", displayName: "TL", persona: "拆任务收口" },
      { id: "compliance", displayName: "合规", persona: "只谈风险" },
    ],
    turnRunner: createSessionTurnRunner({ sessions: runtime.get(SESSION) }),
  });

  room.post({ from: "user", kind: "chat", text: "评估 B0XXX 德国站合规" });
  await room.step();
  await room.step();
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

  const prompt = buildRoomTurnPrompt(
    { id: "compliance", displayName: "合规", persona: "x" },
    room.transcript().filter((m) => m.kind !== "status"),
  );
  assert.match(prompt, /Visible transcript/);

  await runtime.stop();
});
