import type { Tool } from "@typescript-agent-harness/tools";

export type Question = {
  question: string;
  options: string[];
  /** The user may pick more than one option. */
  multiple?: boolean;
};

/**
 * One answer per question: the picked options and / or the user's own text.
 * `"skipped"`: the user dismissed the card (the host then ends the turn); `undefined`: the turn was stopped.
 */
export type AskUser = (questions: Question[], signal: AbortSignal) => Promise<string[][] | "skipped" | undefined>;

export const SKIPPED_NOTE =
  "The user skipped these questions without answering. They were shown to the user as text and the turn ended; the user's next message may answer them in their own words.";

/** The questions as Markdown, shown in the conversation when the user skips the card. */
export function questionsText(questions: Question[]): string {
  return questions
    .map((q) => [`**${q.question}**${q.multiple ? " (pick any)" : ""}`, ...q.options.map((o) => `- ${o}`)].join("\n"))
    .join("\n\n");
}

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

function parse(input: unknown): Question[] {
  const raw = (input as { questions?: unknown } | null | undefined)?.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUESTIONS) {
    throw new Error(`questions must list 1–${MAX_QUESTIONS} questions`);
  }
  return raw.map((q, i) => {
    const { question, options, multiple } = (q ?? {}) as Record<string, unknown>;
    if (typeof question !== "string" || !question.trim()) throw new Error(`questions[${i}].question must be a non-empty string`);
    if (
      !Array.isArray(options) ||
      options.length < MIN_OPTIONS ||
      options.length > MAX_OPTIONS ||
      !options.every((o) => typeof o === "string" && o.trim())
    ) {
      throw new Error(`questions[${i}].options must list ${MIN_OPTIONS}–${MAX_OPTIONS} non-empty strings`);
    }
    return { question: question.trim(), options: options.map((o: string) => o.trim()), ...(multiple === true ? { multiple: true } : {}) };
  });
}

/** Multiple-choice questions shown to the user (web card or terminal); the turn waits for the answers. */
export function askUserTool(ask: AskUser): Tool {
  return {
    name: "ask_user",
    description:
      "Ask the user 1–4 multiple-choice questions and wait for the answers. Use it before doing the work when the request is ambiguous or has several reasonable approaches the user should choose between; do not use it when the request is clear. Keep questions short and give 2–5 concrete options each, the recommended one first. The user may type their own answer instead of picking an option.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: `1–${MAX_QUESTIONS} questions, answered together`,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", description: `${MIN_OPTIONS}–${MAX_OPTIONS} options`, items: { type: "string" } },
              multiple: { type: "boolean", description: "Allow picking more than one option" },
            },
            required: ["question", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const questions = parse(input);
      const answers = await ask(questions, ctx.signal);
      if (!answers) throw new Error("the user did not answer");
      if (answers === "skipped") return { skipped: true, note: SKIPPED_NOTE };
      return { answers: questions.map((q, i) => ({ question: q.question, answer: answers[i] ?? [] })) };
    },
  };
}
