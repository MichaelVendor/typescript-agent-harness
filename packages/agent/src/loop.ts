import type { Context } from "@typescript-agent-harness/core";
import type { ChatMessage, LLMResponse, LLMService, ToolCall } from "@typescript-agent-harness/llm";
import type { ToolService } from "@typescript-agent-harness/tools";
import type {
  AgentLoop,
  RunResult,
  SessionHandle,
} from "./types.js";

function pendingToolCalls(messages: ChatMessage[]): ToolCall[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.toolCalls?.length) {
      const done = new Set<string>();
      for (let j = i + 1; j < messages.length; j += 1) {
        const later = messages[j];
        if (later?.role === "tool") done.add(later.toolCallId);
      }
      return msg.toolCalls.filter((c) => !done.has(c.id));
    }
    if (msg?.role === "user") break;
  }
  return [];
}

export function createDefaultLoop(deps: {
  llm: LLMService;
  tools: ToolService;
  ctx: Pick<Context, "get" | "tryGet" | "emit">;
}): AgentLoop {
  return {
    async *run(session: SessionHandle) {
      const pending = pendingToolCalls(session.messages);
      if (pending.length) {
        for (const call of pending) {
          session.signal.throwIfAborted();
          yield { type: "tool.started", call };
          const toolStepId = `step_tool_${call.id}`;
          session.addStep({
            type: "tool",
            id: toolStepId,
            tool: call.name,
            input: call.arguments,
            status: "pending",
          });
          const toolResult = await deps.tools.execute(call, {
            sessionId: session.id,
            callId: call.id,
            signal: session.signal,
            runtime: deps.ctx,
          });
          session.updateToolStep(toolStepId, toolResult.ok, toolResult.output);
          session.append({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(toolResult.output),
          });
          yield { type: "tool.finished", call, output: toolResult.output };
        }
      }

      let steps = 0;
      while (steps < session.maxSteps) {
        steps += 1;
        session.signal.throwIfAborted();

        const request = {
          messages: [...session.messages],
          tools: deps.tools.listSchemas(),
        };
        const llmStepId = `step_llm_${steps}`;
        session.addStep({
          type: "llm",
          id: llmStepId,
          request,
          status: "pending",
        });

        let response: LLMResponse | undefined;
        for await (const part of deps.llm.stream({
          ...request,
          signal: session.signal,
        })) {
          if (part.type === "text-delta") {
            yield { type: "llm.delta", text: part.text };
          } else if (part.type === "done") {
            response = part.response;
          }
        }
        if (!response) {
          throw new Error("LLM stream ended without a response");
        }

        session.updateLlmStep(llmStepId, response);
        session.append(response.message);
        yield { type: "llm.completed", response };

        const calls = response.toolCalls ?? [];
        if (calls.length === 0) {
          const result: RunResult = {
            sessionId: session.id,
            text: response.message.content ?? "",
            finishReason: response.finishReason,
            steps: [],
          };
          yield { type: "agent.finished", result };
          return;
        }

        for (const call of calls) {
          session.signal.throwIfAborted();
          yield { type: "tool.started", call };
          const toolStepId = `step_tool_${call.id}`;
          session.addStep({
            type: "tool",
            id: toolStepId,
            tool: call.name,
            input: call.arguments,
            status: "pending",
          });
          const toolResult = await deps.tools.execute(call, {
            sessionId: session.id,
            callId: call.id,
            signal: session.signal,
            runtime: deps.ctx,
          });
          session.updateToolStep(toolStepId, toolResult.ok, toolResult.output);
          session.append({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(toolResult.output),
          });
          yield { type: "tool.finished", call, output: toolResult.output };
        }
      }

      yield {
        type: "agent.finished",
        result: {
          sessionId: session.id,
          text: `Stopped: reached the agent LLM step limit (maxSteps=${session.maxSteps}). Split the task into smaller asks, or raise maxSteps when creating the agent.`,
          finishReason: "max_steps",
          steps: [],
        },
      };
    },
  };
}
