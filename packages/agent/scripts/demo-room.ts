/**
 * 三回合 Room demo。默认 mock TurnRunner；`--session` 走真 Session.run（stub LLM）。
 *
 *   node --experimental-strip-types packages/agent/scripts/demo-room.ts
 *   node --experimental-strip-types packages/agent/scripts/demo-room.ts --session
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMRequest, type LLMResponse, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";
import { createRoom, type TurnRunner } from "../src/room.ts";
import { createSessionTurnRunner } from "../src/room-session.ts";

const useSession = process.argv.includes("--session");
const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const persistDir = path.join(root, "out", "rooms", `demo-${Date.now()}`);

const mockRunner: TurnRunner = async ({ member, visible }) => {
  console.log(`\n--- turn: ${member.id}（可见 ${visible.length} 条）---`);
  if (member.id === "tl") {
    const hasResult = visible.some((m) => m.kind === "result");
    if (!hasResult) {
      return {
        kind: "delegate",
        text: "请核查 B0XXX 德国站合规风险，只基于工具返回，缺数据写缺口。",
        mention: ["compliance"],
      };
    }
    return {
      kind: "status",
      text: "DONE\n综合：合规建议观察；暂不上架。缺口：真实认证文件。",
      done: true,
    };
  }
  return {
    kind: "result",
    text: "风险：认证缺失（演示）；建议观察，不要直接上架。",
    traceHint: { tools: ["compliance_check"], ok: true },
  };
};

function lastUserText(request: LLMRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const m = request.messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function stubRoomLlm(): LLMService {
  let tlPasses = 0;
  const llm: LLMService = {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      const user = lastUserText(request);
      const content = user.includes('member "compliance"')
        ? JSON.stringify({
            kind: "result",
            text: "风险：认证缺失（Session 演示）；建议观察。",
          })
        : (++tlPasses === 1
            ? JSON.stringify({
                kind: "delegate",
                text: "请核查 B0XXX 德国站合规风险。",
                mention: ["compliance"],
              })
            : JSON.stringify({
                kind: "status",
                text: "DONE\n综合：观察，暂不上架。",
                done: true,
              }));
      return {
        id: "demo",
        model: "stub",
        message: { role: "assistant", content },
        finishReason: "stop",
      };
    },
    async *stream(request) {
      const response = await llm.generate(request);
      console.log(`\n--- session turn ---`);
      yield { type: "text-delta", text: response.message.content ?? "" };
      yield { type: "done", response };
    },
  };
  return llm;
}

let runtime: Runtime | undefined;
let turnRunner = mockRunner;

if (useSession) {
  runtime = new Runtime({ id: "demo-room" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, stubRoomLlm()) })
    .use(toolsPlugin())
    .use(agentPlugin({ maxSteps: 4 }));
  await runtime.start();
  turnRunner = createSessionTurnRunner({ sessions: runtime.get(SESSION) });
  console.log("mode=session (真 Session.run + stub LLM)");
} else {
  console.log("mode=mock TurnRunner");
}

const room = createRoom({
  goal: "评估 ASIN B0XXX 上架德国站的合规风险",
  persistDir,
  members: [
    { id: "tl", displayName: "运营 TL", persona: "拆任务并收口" },
    { id: "compliance", displayName: "合规", persona: "只谈合规，不编造认证" },
  ],
  turnRunner,
});

room.post({
  from: "user",
  kind: "chat",
  text: "目标：评估 ASIN B0XXX 上架德国站的合规风险，给出是否建议上架。",
});

for (let i = 0; i < 8 && room.meta.status !== "done"; i += 1) {
  const msg = await room.step();
  if (!msg) break;
  console.log(`[${msg.from}/${msg.kind}] ${msg.text.slice(0, 120)}`);
}

console.log(`\nstatus=${room.meta.status}`);
console.log(`transcript → ${persistDir}`);
if (room.meta.status !== "done") {
  console.error("demo 未到达 done");
  process.exitCode = 1;
}
await runtime?.stop();
