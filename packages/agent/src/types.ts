import type { LLMRequest, LLMResponse, ToolCall } from "@typescript-agent-harness/llm";
import type { ChatMessage } from "@typescript-agent-harness/llm";

export type SessionState =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStep =
  | {
      type: "llm";
      id: string;
      request: LLMRequest;
      response?: LLMResponse;
      status: "pending" | "completed" | "failed";
    }
  | {
      type: "tool";
      id: string;
      tool: string;
      input: unknown;
      output?: unknown;
      status: "pending" | "completed" | "failed";
    };

export type SessionEvent = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
};

export type RunResult = {
  sessionId: string;
  text: string;
  finishReason: LLMResponse["finishReason"] | "max_steps";
  steps: AgentStep[];
};

export type SessionSummary = {
  id: string;
  state: SessionState;
  messageCount: number;
};

export interface Session {
  readonly id: string;
  readonly state: SessionState;
  readonly messages: ChatMessage[];
  readonly steps: AgentStep[];
  readonly events: SessionEvent[];

  run(input: string): Promise<RunResult>;
  resume(): Promise<RunResult>;
  cancel(): Promise<void>;
}

export type SessionService = {
  create(): Promise<Session>;
  get(sessionId: string): Promise<Session | undefined>;
  list(): Promise<SessionSummary[]>;
};

export type AgentLoopEvent =
  | { type: "llm.delta"; text: string }
  | { type: "llm.completed"; response: LLMResponse }
  | { type: "tool.started"; call: ToolCall }
  | { type: "tool.finished"; call: ToolCall; output: unknown }
  | { type: "agent.finished"; result: RunResult };

export type AgentLoop = {
  run(session: SessionHandle): AsyncIterable<AgentLoopEvent>;
};

/** Internal handle the loop uses — implementation lives in session.ts */
export type SessionHandle = {
  id: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  maxSteps: number;
  append(message: ChatMessage): void;
  addStep(step: AgentStep): void;
  updateLlmStep(id: string, response: LLMResponse): void;
  updateToolStep(id: string, ok: boolean, output: unknown): void;
};
