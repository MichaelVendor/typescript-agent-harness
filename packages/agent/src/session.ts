import type { Context } from "@typescript-agent-harness/core";
import type { ChatMessage, ContentPart } from "@typescript-agent-harness/llm";
import type { StorageService } from "@typescript-agent-harness/storage";
import { pendingToolCalls } from "./loop.js";
import type { AgentLoop } from "./types.js";
import type {
  AgentStep,
  RunResult,
  Session,
  SessionEvent,
  SessionHandle,
  SessionState,
} from "./types.js";

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq}_${Date.now().toString(36)}`;
}

export type SessionInit = {
  id?: string;
  loop: AgentLoop;
  bus: Pick<Context, "emit">;
  maxSteps: number;
  systemPrompt?: string;
  storage?: StorageService | undefined;
  restored?: {
    state: SessionState;
    messages: ChatMessage[];
    steps: AgentStep[];
    events: SessionEvent[];
    createdAt: number;
  };
};

export class MemorySession implements Session {
  readonly id: string;
  private _state: SessionState = "idle";
  private readonly _messages: ChatMessage[] = [];
  private readonly _steps: AgentStep[] = [];
  private readonly _events: SessionEvent[] = [];
  private abort = new AbortController();
  private lastResult: RunResult | undefined;
  private readonly createdAt: number;
  private persistedEventIds = new Set<string>();
  private readonly loop: AgentLoop;
  private readonly bus: Pick<Context, "emit">;
  private readonly maxSteps: number;
  private readonly storage: StorageService | undefined;

  constructor(init: SessionInit) {
    this.loop = init.loop;
    this.bus = init.bus;
    this.maxSteps = init.maxSteps;
    this.storage = init.storage;
    this.id = init.id ?? nextId("session");
    this.createdAt = init.restored?.createdAt ?? Date.now();

    if (init.restored) {
      this._state =
        init.restored.state === "running" ? "failed" : init.restored.state;
      this._messages.push(...init.restored.messages);
      if (init.systemPrompt) {
        const system = { role: "system" as const, content: init.systemPrompt };
        if (this._messages[0]?.role === "system") this._messages[0] = system;
        else this._messages.unshift(system);
      }
      this._steps.push(
        ...init.restored.steps.filter((s) => s.status !== "pending"),
      );
      this._events.push(...init.restored.events);
      for (const e of this._events) this.persistedEventIds.add(e.id);
      const last = [...this._messages].reverse().find((m) => m.role === "assistant");
      if (last?.content && this._state === "completed") {
        this.lastResult = {
          sessionId: this.id,
          text: last.content,
          finishReason: "stop",
          steps: [...this._steps],
        };
      }
    } else if (init.systemPrompt) {
      this._messages.push({ role: "system", content: init.systemPrompt });
    }
  }

  get state(): SessionState {
    return this._state;
  }

  get messages(): ChatMessage[] {
    return this._messages;
  }

  get steps(): AgentStep[] {
    return this._steps;
  }

  get events(): SessionEvent[] {
    return this._events;
  }

  /**
   * `string` is the usual text turn. Pass `{ text, content }` when the model should see
   * multimodal parts (or a composed prompt) while events still show `text`.
   */
  async run(input: string | { text: string; content?: string | ContentPart[] }): Promise<RunResult> {
    if (this._state === "running") {
      throw new Error(`session ${this.id} is already running`);
    }
    this.abort = new AbortController();
    // Providers reject a request whose assistant tool_calls lack results (e.g. after cancel/crash mid-tool).
    for (const call of pendingToolCalls(this._messages)) {
      this._messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify({ error: "not run: the previous turn was interrupted" }),
      });
    }
    const text = typeof input === "string" ? input : input.text;
    const content = typeof input === "string" ? input : (input.content ?? input.text);
    this._messages.push({ role: "user", content });
    this.record("user.message", { content: text });
    await this.persist();
    return this.drive();
  }

  async resume(): Promise<RunResult> {
    if (this._state === "running") {
      throw new Error(`session ${this.id} is already running`);
    }
    if (this._state === "completed" && this.lastResult) {
      return this.lastResult;
    }
    this.abort = new AbortController();
    return this.drive();
  }

  async cancel(): Promise<void> {
    this.abort.abort();
  }

  private handle(): SessionHandle {
    return {
      id: this.id,
      messages: this._messages,
      signal: this.abort.signal,
      maxSteps: this.maxSteps,
      append: (message) => this._messages.push(message),
      addStep: (step) => this._steps.push(step),
      updateLlmStep: (id, response) => {
        const step = this._steps.find((s) => s.id === id);
        if (step && step.type === "llm") {
          step.response = response;
          step.status = "completed";
        }
      },
      updateToolStep: (id, ok, output) => {
        const step = this._steps.find((s) => s.id === id);
        if (step && step.type === "tool") {
          step.output = output;
          step.status = ok ? "completed" : "failed";
        }
      },
    };
  }

  private record(type: string, payload: unknown): SessionEvent {
    const event: SessionEvent = {
      id: nextId("evt"),
      type,
      payload,
      createdAt: Date.now(),
    };
    this._events.push(event);
    return event;
  }

  private checkpointMeta(): { stepId: string | null; stepType: string | null } {
    const last = [...this._steps].reverse().find((s) => s.status !== "pending");
    if (!last) return { stepId: null, stepType: null };
    return { stepId: last.id, stepType: last.type };
  }

  async persist(checkpoint = false): Promise<void> {
    if (!this.storage) return;
    const now = Date.now();
    await this.storage.saveSession({
      id: this.id,
      status: this._state,
      maxSteps: this.maxSteps,
      messagesJson: JSON.stringify(this._messages),
      stepsJson: JSON.stringify(this._steps),
      createdAt: this.createdAt,
      updatedAt: now,
    });
    for (const event of this._events) {
      if (this.persistedEventIds.has(event.id)) continue;
      await this.storage.appendEvent({
        id: event.id,
        sessionId: this.id,
        type: event.type,
        payloadJson: JSON.stringify(event.payload),
        createdAt: event.createdAt,
      });
      this.persistedEventIds.add(event.id);
    }
    if (checkpoint) {
      const meta = this.checkpointMeta();
      const row = {
        id: nextId("ckpt"),
        sessionId: this.id,
        stepId: meta.stepId,
        stepType: meta.stepType,
        messageCount: this._messages.length,
        createdAt: now,
      };
      await this.storage.saveCheckpoint(row);
      await this.bus.emit("storage.checkpoint", {
        sessionId: this.id,
        checkpointId: row.id,
        stepId: meta.stepId,
        stepType: meta.stepType,
      });
    }
  }

  private async drive(): Promise<RunResult> {
    this._state = "running";
    const turnId = nextId("turn");
    await this.bus.emit("session.turn.start", { sessionId: this.id, turnId });
    await this.bus.emit("agent.started", { sessionId: this.id });
    this.record("agent.started", { sessionId: this.id });
    await this.persist();

    try {
      let finished: RunResult | undefined;
      for await (const event of this.loop.run(this.handle())) {
        if (event.type === "llm.delta") {
          await this.bus.emit("agent.assistant-stream", {
            sessionId: this.id,
            text: event.text,
          });
        } else if (event.type === "llm.completed") {
          this.record("llm.completed", { finishReason: event.response.finishReason });
          await this.persist(true);
        } else if (event.type === "tool.finished") {
          this.record("tool.finished", { tool: event.call.name });
          await this.persist(true);
        } else if (event.type === "agent.finished") {
          finished = {
            ...event.result,
            steps: [...this._steps],
          };
        }
      }
      if (!finished) {
        throw new Error("agent loop ended without a result");
      }
      this.lastResult = finished;
      this._state = finished.finishReason === "max_steps" ? "failed" : "completed";
      await this.bus.emit("agent.finished", {
        sessionId: this.id,
        text: finished.text,
        finishReason: finished.finishReason,
      });
      await this.bus.emit("session.turn.end", { sessionId: this.id, turnId });
      this.record("agent.finished", { finishReason: finished.finishReason });
      await this.persist(true);
      return finished;
    } catch (error) {
      if (this.abort.signal.aborted) {
        this._state = "cancelled";
        await this.bus.emit("agent.cancelled", { sessionId: this.id });
        await this.persist();
        throw error;
      }
      this._state = "failed";
      await this.bus.emit("agent.failed", {
        sessionId: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.persist();
      throw error;
    }
  }
}
