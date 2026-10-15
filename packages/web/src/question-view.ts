import type { Question } from "@typescript-agent-harness/cli";

/** What the user has chosen on an `ask_user` card, per question. */
export type Draft = { picked: number[]; other: string };

export const emptyDrafts = (questions: Question[]): Draft[] => questions.map(() => ({ picked: [], other: "" }));

/** A single-choice pick replaces the typed answer, and typing replaces the pick; multiple choice keeps both. */
export function pick(question: Question, draft: Draft, index: number): Draft {
  if (!question.multiple) return { picked: [index], other: "" };
  const picked = draft.picked.includes(index) ? draft.picked.filter((i) => i !== index) : [...draft.picked, index];
  return { ...draft, picked };
}

export function typeOther(question: Question, draft: Draft, other: string): Draft {
  return question.multiple ? { ...draft, other } : { picked: other.trim() ? [] : draft.picked, other };
}

export function answerOf(question: Question, draft: Draft): string[] {
  const chosen = [...draft.picked].sort((a, b) => a - b).flatMap((i) => question.options[i] ?? []);
  const other = draft.other.trim();
  return other ? [...chosen, other] : chosen;
}

/** The answers to send, or undefined while a question is still unanswered. */
export function answersOf(questions: Question[], drafts: Draft[]): string[][] | undefined {
  const answers = questions.map((q, i) => answerOf(q, drafts[i] ?? { picked: [], other: "" }));
  return answers.every((a) => a.length > 0) ? answers : undefined;
}
