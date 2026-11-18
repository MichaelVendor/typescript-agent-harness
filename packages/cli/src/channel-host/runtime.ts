/**
 * Channel-host SuperAgent glue: inbound → ingest/step → outbound reply.
 * Does not touch DefaultLoop / serve chat.
 */
import os from "node:os";
import {
  SESSION,
  agentPlugin,
  createSuperAgent,
  createSessionSuperAgentRunners,
  type RouterAction,
  type SuperAgent,
  type SuperAgentEvent,
} from "@typescript-agent-harness/agent";
import {
  toSuperAgentEvent,
  type ChannelAdapter,
  type InboundMessage,
  type ReplyHandle,
} from "@typescript-agent-harness/channels";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, llmPlugin, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";
import { activeModel, defaultBaseURL } from "../settings.js";

export type ChannelHostEngine = {
  sa: SuperAgent;
  handleInbound(msg: InboundMessage): void;
  /** Drain step loop until idle / needs_human (or maxSteps). */
  pump(maxSteps?: number): Promise<void>;
  stop(): Promise<void>;
};

export type CreateChannelHostEngineInput = {
  persistDir: string;
  adapters: ChannelAdapter[];
  /** stub LLM for --mock */
  mockLlm?: boolean;
  llm?: LLMService;
  homeDir?: string;
};

function stubLlm(): LLMService {
  const llm: LLMService = {
    async generate(request) {
      const last = [...request.messages].reverse().find((m) => m.role === "user");
      const user = typeof last?.content === "string" ? last.content : "";
      let content: string;
      if (user.includes("You are the Super-agent Router")) {
        if (user.includes("[worker_report")) {
          content = JSON.stringify({ type: "reply", text: `DONE：${extractWorkerText(user)}` });
        } else {
          const goal = extractUserGoal(user);
          content = JSON.stringify({
            type: "spawn_ticket",
            goal,
            threadId: extractHintThread(user) ?? "channel:default",
          });
        }
      } else {
        content = JSON.stringify({ text: "已处理（channel-host mock）", done: true });
      }
      return {
        id: "ch",
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

function extractUserGoal(prompt: string): string {
  const m = /\[user\] (.+)/.exec(prompt);
  const raw = m?.[1]?.trim() || "channel task";
  return raw.replace(/\nthreadIdHint=\S+/g, "").trim() || "channel task";
}

function extractWorkerText(prompt: string): string {
  const m = /\[worker_report[^\]]*\] (.+)/.exec(prompt);
  return m?.[1]?.trim() || "ok";
}

function extractHintThread(prompt: string): string | undefined {
  const m = /threadIdHint=(\S+)/.exec(prompt);
  return m?.[1];
}

export async function createChannelHostEngine(
  input: CreateChannelHostEngineInput,
): Promise<ChannelHostEngine> {
  const routes = new Map<string, ReplyHandle>();
  let lastRoute: ReplyHandle | undefined;
  let lastThreadId: string | undefined;
  const adapterByName = new Map(input.adapters.map((a) => [a.name, a]));

  const runtime = new Runtime({ id: "channel-host" });
  const useMock = input.mockLlm === true;
  if (input.llm) {
    runtime.use({ name: "channel-llm", setup: (ctx) => ctx.provide(LLM, input.llm!) });
  } else if (useMock) {
    runtime.use({ name: "channel-llm", setup: (ctx) => ctx.provide(LLM, stubLlm()) });
  } else {
    const home = input.homeDir ?? os.homedir();
    const chosen = activeModel(home);
    const hasKey =
      Boolean(chosen) || Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY);
    if (!hasKey) {
      throw new Error(
        "channel-host: set DEEPSEEK_API_KEY or OPENAI_API_KEY in .env, or pick a model in Settings, or pass --mock",
      );
    }
    runtime.use(
      llmPlugin(
        chosen
          ? {
              provider: "openai-compatible",
              apiKey: chosen.apiKey,
              baseURL: chosen.baseURL ?? defaultBaseURL(chosen.model),
              defaultModel: chosen.model,
            }
          : { provider: "openai-compatible" },
      ),
    );
  }
  runtime.use(toolsPlugin()).use(agentPlugin({ maxSteps: 16 }));
  await runtime.start();

  const base = createSessionSuperAgentRunners({ sessions: runtime.get(SESSION) });

  const sa = createSuperAgent({
    persistDir: input.persistDir,
    restore: true,
    defaultMandate: { scope: "channel-host", policyVersion: "p0" },
    async routerDecide(decideInput) {
      // Hint thread for stub / model via prompt prefix when event is user_message
      let patched = decideInput;
      if (decideInput.event.kind === "user_message" && lastThreadId) {
        patched = {
          ...decideInput,
          event: {
            ...decideInput.event,
            text: `${decideInput.event.text}\nthreadIdHint=${lastThreadId}`,
          },
        };
      }
      const action = await base.routerDecide(patched);
      if (action.type === "spawn_ticket" && !action.threadId && lastThreadId) {
        return { ...action, threadId: lastThreadId } satisfies RouterAction;
      }
      return action;
    },
    workerRun: base.workerRun,
  });

  async function outbound(text: string): Promise<void> {
    const handle = (lastThreadId && routes.get(lastThreadId)) || lastRoute;
    if (!handle) {
      console.log(`[channel-host] no reply route for: ${text.slice(0, 80)}`);
      return;
    }
    const name = handle.kind === "mock" ? "mock" : handle.kind;
    const adapter = adapterByName.get(name) ?? [...adapterByName.values()][0];
    if (!adapter) return;
    await adapter.send(handle, text);
  }

  let pumping: Promise<void> | undefined;

  async function pump(maxSteps = 32): Promise<void> {
    for (let i = 0; i < maxSteps; i += 1) {
      const out = await sa.step();
      if (!out) break;
      if (out.phase === "router" && out.detail && typeof out.detail === "object") {
        const d = out.detail as Record<string, unknown>;
        if (d.type === "reply" && typeof d.text === "string") await outbound(d.text);
        if (d.type === "ask_human" && typeof d.text === "string") {
          await outbound(`[needs_human] ${d.text}`);
        }
      }
      if (sa.meta.status === "needs_human") break;
    }
  }

  function schedulePump(): void {
    if (pumping) return;
    pumping = pump()
      .catch((err) => console.error("[channel-host] pump:", err))
      .finally(() => {
        pumping = undefined;
      });
  }

  function handleInbound(msg: InboundMessage): void {
    routes.set(msg.threadId, msg.replyTo);
    lastRoute = msg.replyTo;
    lastThreadId = msg.threadId;

    const liveSub = sa
      .tickets()
      .some(
        (t) =>
          t.status === "running" &&
          sa.reviewPanel().subscriptions.some((s) => s.threadId === msg.threadId && s.ticketId === t.id),
      );
    let event: SuperAgentEvent;
    if (liveSub || !msg.isNewThread) {
      event = {
        kind: "source_event",
        source: msg.source,
        threadId: msg.threadId,
        text: msg.text,
      };
    } else {
      // 私聊每条默认 isNewThread；无 running 订阅时走 Router（可闲聊/新任务）
      event = toSuperAgentEvent({ ...msg, isNewThread: true }) as SuperAgentEvent;
    }
    sa.ingest(event);
    schedulePump();
  }

  for (const adapter of input.adapters) {
    await adapter.start({ onMessage: handleInbound });
  }

  return {
    sa,
    handleInbound,
    pump,
    async stop() {
      for (const adapter of input.adapters) await adapter.stop();
      await runtime.stop();
    },
  };
}
