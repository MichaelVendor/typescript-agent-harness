import type { ChatMessage, LLMService } from "@typescript-agent-harness/llm";

export const SUMMARY_PREFIX = "[Summary of the earlier conversation]";

export type Compaction = { turns: number; chars: number };

const CLIP_MESSAGE = 4000;
const CLIP_TOOL = 1500;
const MAX_INPUT = 200_000;

const SUMMARY_PROMPT = [
  "You compress a coding agent's conversation so the work can continue without the original messages.",
  "Write a concise summary in the language the user writes in, using short bullet points under these headings:",
  "Goal (what the user wants), Decisions and constraints, Files and changes (paths and what changed), Commands and results, Open tasks (what is left, including any task list), Important facts.",
  "Keep exact paths, names, numbers and error messages that later work may need. Drop greetings, repetition and raw file contents.",
].join(" ");

function headLength(messages: ChatMessage[]): number {
  let start = 0;
  while (messages[start]?.role === "system" && !isSummary(messages[start]!)) start += 1;
  return start;
}

function isSummary(m: ChatMessage): boolean {
  return m.role === "system" && m.content.startsWith(SUMMARY_PREFIX);
}

/** Index of the latest summary message, or -1. */
export function lastSummaryIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (isSummary(messages[i]!)) return i;
  return -1;
}

/** What the model sees: the latest summary joins the system prompt and replaces everything before it. */
export function applySummary(messages: ChatMessage[]): ChatMessage[] {
  const k = lastSummaryIndex(messages);
  if (k < 0) return messages;
  const head = messages.slice(0, headLength(messages));
  const summary = (messages[k] as { content: string }).content;
  const first = head[0];
  if (first?.role === "system") head[0] = { role: "system", content: `${first.content}\n\n${summary}` };
  else head.unshift({ role: "system", content: summary });
  return [...head, ...messages.slice(k + 1)];
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} more chars]` : s;
}

function transcript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n");
      lines.push(`USER: ${clip(text, CLIP_MESSAGE)}`);
    } else if (m.role === "assistant") {
      if (m.content) lines.push(`ASSISTANT: ${clip(m.content, CLIP_MESSAGE)}`);
      for (const c of m.toolCalls ?? []) lines.push(`TOOL CALL ${c.name}: ${clip(JSON.stringify(c.arguments), CLIP_TOOL)}`);
    } else {
      lines.push(`TOOL RESULT: ${clip(m.content, CLIP_TOOL)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > MAX_INPUT ? `[earliest part cut]\n${text.slice(-MAX_INPUT)}` : text;
}

/**
 * Summarizes the turns before `end` (since the last summary) and inserts the summary at `end`.
 * Full history stays in `messages`; `applySummary` hides what the summary covers. `undefined`: nothing to compact.
 */
export async function compactHistory(
  llm: LLMService,
  messages: ChatMessage[],
  end: number,
  signal?: AbortSignal,
): Promise<Compaction | undefined> {
  const k = lastSummaryIndex(messages);
  const from = k >= 0 ? k + 1 : headLength(messages);
  const covered = messages.slice(from, end);
  const turns = covered.filter((m) => m.role === "user").length;
  if (turns === 0) return undefined;

  const previous = k >= 0 ? `Summary so far:\n${(messages[k] as { content: string }).content.slice(SUMMARY_PREFIX.length).trim()}\n\nLater conversation:\n` : "";
  const response = await llm.generate({
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: `${previous}${transcript(covered)}` },
    ],
    ...(signal ? { signal } : {}),
  });
  const text = response.message.content?.trim();
  if (!text) throw new Error("compaction: the model returned an empty summary");
  const content = `${SUMMARY_PREFIX}\n${text}`;
  messages.splice(end, 0, { role: "system", content });
  return { turns, chars: content.length };
}
