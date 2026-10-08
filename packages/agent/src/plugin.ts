import { createServiceKey, type Plugin } from "@typescript-agent-harness/core";
import { LLM, type ChatMessage } from "@typescript-agent-harness/llm";
import { STORAGE } from "@typescript-agent-harness/storage";
import { TOOLS } from "@typescript-agent-harness/tools";
import { createDefaultLoop } from "./loop.js";
import { MemorySession } from "./session.js";
import type {
  AgentStep,
  Session,
  SessionEvent,
  SessionService,
  SessionState,
  SessionSummary,
} from "./types.js";

export const SESSION = createServiceKey<SessionService>("session");

export type AgentPluginOptions = {
  /** Also replaces the stored system prompt when a persisted session is reopened. */
  systemPrompt?: string;
  maxSteps?: number;
  /** Char budget per LLM request (old tool outputs, then old turns are trimmed). Unset = no limit. */
  contextChars?: number;
};

/** History up to (not including) the user message that starts turn `turns + 1`. */
function firstTurns(messages: ChatMessage[], turns: number | undefined): ChatMessage[] {
  if (turns === undefined) return messages;
  let seen = 0;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]!.role === "user") {
      seen += 1;
      if (seen > turns) return messages.slice(0, i);
    }
  }
  return messages;
}

function asState(value: string): SessionState {
  if (
    value === "idle" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "idle";
}

export function agentPlugin(options: AgentPluginOptions = {}): Plugin {
  const maxSteps = options.maxSteps ?? 8;
  const systemPrompt =
    options.systemPrompt ??
    "You are a helpful agent. Use tools when they help answer the user.";

  return {
    name: "agent",
    setup(ctx) {
      const llm = ctx.get(LLM);
      const tools = ctx.get(TOOLS);
      const storage = ctx.tryGet(STORAGE);
      const loop = createDefaultLoop({
        llm,
        tools,
        ctx,
        ...(options.contextChars !== undefined ? { contextChars: options.contextChars } : {}),
      });
      const sessions = new Map<string, Session>();

      async function hydrate(id: string): Promise<Session | undefined> {
        const hit = sessions.get(id);
        if (hit) return hit;
        if (!storage) return undefined;
        const row = await storage.getSession(id);
        if (!row) return undefined;
        const storedEvents = await storage.listEvents(id);
        const session = new MemorySession({
          id: row.id,
          loop,
          bus: ctx,
          maxSteps: row.maxSteps,
          systemPrompt,
          storage,
          restored: {
            state: asState(row.status),
            messages: JSON.parse(row.messagesJson) as ChatMessage[],
            steps: JSON.parse(row.stepsJson) as AgentStep[],
            events: storedEvents.map((e) => ({
              id: e.id,
              type: e.type,
              payload: JSON.parse(e.payloadJson) as unknown,
              createdAt: e.createdAt,
            })) as SessionEvent[],
            createdAt: row.createdAt,
          },
        });
        sessions.set(session.id, session);
        return session;
      }

      const service: SessionService = {
        async create() {
          const session = new MemorySession({
            loop,
            bus: ctx,
            maxSteps,
            systemPrompt,
            ...(storage ? { storage } : {}),
          });
          sessions.set(session.id, session);
          await session.persist();
          await ctx.emit("session.created", { sessionId: session.id });
          return session;
        },
        async get(sessionId) {
          return hydrate(sessionId);
        },
        async fork(sessionId, forkOptions = {}) {
          const source = await hydrate(sessionId);
          if (!source) throw new Error(`session not found: ${sessionId}`);
          const { turns } = forkOptions;
          if (turns !== undefined && (!Number.isInteger(turns) || turns < 0)) {
            throw new Error(`fork turns must be a non-negative integer, got ${turns}`);
          }
          const session = new MemorySession({
            loop,
            bus: ctx,
            maxSteps,
            systemPrompt,
            ...(storage ? { storage } : {}),
            restored: {
              state: "idle",
              messages: structuredClone(firstTurns(source.messages, turns)),
              steps: [],
              events: [],
              createdAt: Date.now(),
            },
          });
          sessions.set(session.id, session);
          await session.persist();
          await ctx.emit("session.forked", {
            sessionId: session.id,
            parentId: sessionId,
            turns: session.messages.filter((m) => m.role === "user").length,
          });
          return session;
        },
        async list(): Promise<SessionSummary[]> {
          if (storage) {
            const rows = await storage.listSessions();
            return rows.map((row) => ({
              id: row.id,
              state: asState(row.status),
              messageCount: (JSON.parse(row.messagesJson) as unknown[]).length,
            }));
          }
          return [...sessions.values()].map((s) => ({
            id: s.id,
            state: s.state,
            messageCount: s.messages.length,
          }));
        },
      };

      ctx.provide(SESSION, service);
    },
  };
}
