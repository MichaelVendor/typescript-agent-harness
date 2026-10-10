import type { ChatMessage } from "@typescript-agent-harness/llm";

export type ContextProjection = {
  messages: ChatMessage[];
  droppedTurns: number;
  elidedToolResults: number;
  chars: number;
};

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

const ELIDED = "[tool output omitted to fit the context window";

function size(m: ChatMessage): number {
  let n = 0;
  if (typeof m.content === "string") n = m.content.length;
  else if (Array.isArray(m.content)) n = JSON.stringify(m.content).length;
  if (m.role === "assistant" && m.toolCalls) n += JSON.stringify(m.toolCalls).length;
  return n;
}

function total(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + size(m), 0);
}

function elide(m: ToolMessage): ToolMessage {
  return { ...m, content: `${ELIDED}: ${m.content.length} chars]` };
}

/**
 * Pure projection of session history into what the model sees under a char budget.
 * Never drops the latest turn and never splits a turn, so tool calls stay paired with results.
 */
export function projectContext(
  messages: ChatMessage[],
  budgetChars: number,
): ContextProjection {
  let start = 0;
  while (messages[start]?.role === "system") start += 1;
  const head = messages.slice(0, start);

  const turns: ChatMessage[][] = [];
  for (const m of messages.slice(start)) {
    if (m.role === "user" || turns.length === 0) turns.push([m]);
    else turns[turns.length - 1]!.push(m);
  }

  let droppedTurns = 0;
  let elidedToolResults = 0;
  const fits = () =>
    total(head) + turns.reduce((n, t) => n + total(t), 0) <= budgetChars;
  const elideIn = (turn: ChatMessage[], end: number) => {
    for (let j = 0; j < end && !fits(); j += 1) {
      const m = turn[j]!;
      if (m.role === "tool" && !m.content.startsWith(ELIDED)) {
        turn[j] = elide(m);
        elidedToolResults += 1;
      }
    }
  };

  for (let i = 0; i < turns.length - 1 && !fits(); i += 1) {
    elideIn(turns[i]!, turns[i]!.length);
  }
  while (turns.length > 1 && !fits()) {
    turns.shift();
    droppedTurns += 1;
  }
  const current = turns[turns.length - 1];
  if (current && !fits()) {
    let lastAssistant = current.length - 1;
    while (lastAssistant >= 0 && current[lastAssistant]!.role !== "assistant") lastAssistant -= 1;
    elideIn(current, lastAssistant);
  }

  if (droppedTurns > 0) {
    const note = `[${droppedTurns} earlier conversation turn(s) omitted to fit the context window.]`;
    const first = head[0];
    if (first?.role === "system") head[0] = { role: "system", content: `${first.content}\n\n${note}` };
    else head.unshift({ role: "system", content: note });
  }

  const out = [...head, ...turns.flat()];
  return { messages: out, droppedTurns, elidedToolResults, chars: total(out) };
}
