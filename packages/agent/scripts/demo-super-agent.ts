/**
 * Super-agent demo。默认 mock；`--session` 走真 Session.run（stub LLM）。
 *
 *   node --experimental-strip-types packages/agent/scripts/demo-super-agent.ts
 *   node --experimental-strip-types packages/agent/scripts/demo-super-agent.ts --session
 *   node --experimental-strip-types packages/agent/scripts/demo-super-agent.ts --github
 *
 * 侧栏只读工单（另开终端）:
 *   tah serve --super-agent-panel <上面打印的 persist 路径>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMRequest, type LLMResponse, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";
import {
  createSuperAgent,
  type CreateSuperAgentInput,
} from "../src/super-agent.ts";
import { createSessionSuperAgentRunners } from "../src/super-agent-session.ts";
import { createMockGitHubSource } from "../src/super-agent-source.ts";

const useSession = process.argv.includes("--session");
const useGithub = process.argv.includes("--github");
const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const persistDir = path.join(root, "out", "super-agent", `demo-${Date.now()}`);

function lastUserText(request: LLMRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const m = request.messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function stubLlm(): LLMService {
  const llm: LLMService = {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      const user = lastUserText(request);
      const content = user.includes("You are the Super-agent Router")
        ? user.includes("[worker_report")
          ? JSON.stringify({ type: "reply", text: "DONE：已根据 Worker 结果回复用户。" })
          : JSON.stringify({
              type: "spawn_ticket",
              goal: "评估并修复演示缺陷",
              threadId: "github:pr/demo",
            })
        : user.includes("Mailbox") && user.includes("[github]")
          ? JSON.stringify({ text: "已按 PR 评论修改（演示）", done: true })
          : JSON.stringify({ text: "已开 PR（演示）", done: true });
      return {
        id: "demo",
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
  return llm;
}

let runtime: Runtime | undefined;
let runners: Pick<CreateSuperAgentInput, "routerDecide" | "workerRun">;

if (useSession) {
  runtime = new Runtime({ id: "demo-super-agent" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, stubLlm()) })
    .use(toolsPlugin())
    .use(agentPlugin({ maxSteps: 4 }));
  await runtime.start();
  runners = createSessionSuperAgentRunners({ sessions: runtime.get(SESSION) });
  console.log("mode=session (真 Session.run + stub LLM)");
} else {
  console.log(useGithub ? "mode=mock+github" : "mode=mock");
  runners = {
    async routerDecide({ event }) {
      if (event.kind === "user_message") {
        return { type: "spawn_ticket", goal: event.text, threadId: "github:pr/demo" };
      }
      if (event.kind === "worker_report") {
        return { type: "reply", text: `DONE：${event.text}` };
      }
      return { type: "reply", text: "ok" };
    },
    async workerRun({ mailbox }) {
      if (mailbox.some((e) => e.kind === "source_event")) {
        return { text: "已按 PR 评论修改（mock）", done: true };
      }
      if (useGithub) return { text: "等待评论", done: false };
      return { text: "已开 PR（mock）", done: true };
    },
  };
}

const sa = createSuperAgent({
  persistDir,
  ticketTimeoutMs: 60_000,
  defaultMandate: { scope: "demo only", policyVersion: "s3" },
  ...runners,
});

sa.ingest({ kind: "user_message", text: "请修一下登录页的空指针", channel: "cli" });

// spawn + 首轮 worker；--github 时停在 waiting，再注入评论
for (let i = 0; i < (useGithub ? 2 : 8); i += 1) {
  const out = await sa.step();
  if (!out) break;
  console.log(`[${out.phase}]`, JSON.stringify(out.detail).slice(0, 160));
}

if (useGithub) {
  const gh = createMockGitHubSource();
  sa.ingest(
    gh.toSourceEvent({
      threadId: "github:pr/demo",
      body: "请补单测",
      author: "reviewer",
      kind: "pull_request",
    }),
  );
  for (let i = 0; i < 6; i += 1) {
    const out = await sa.step();
    if (!out) break;
    console.log(`[${out.phase}]`, JSON.stringify(out.detail).slice(0, 160));
  }
}

console.log(`\nstatus=${sa.meta.status}`);
console.log(`replies=${JSON.stringify(sa.replies())}`);
console.log(`tickets=${sa.tickets().map((t) => `${t.status}:${t.goal}`).join(" | ")}`);
console.log(`panel=${JSON.stringify(sa.reviewPanel())}`);
console.log(`persist → ${persistDir}`);

const ok =
  sa.meta.status === "idle" &&
  sa.replies().length > 0 &&
  sa.tickets().some((t) => t.status === "done");
if (!ok) {
  console.error("demo 未到达期望终态");
  process.exitCode = 1;
}
await runtime?.stop();
