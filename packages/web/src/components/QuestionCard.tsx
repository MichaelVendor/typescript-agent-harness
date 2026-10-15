import { useState } from "react";
import { answerOf, answersOf, emptyDrafts, firstUnanswered, pick, typeOther, type Draft } from "../question-view";
import type { PendingQuestion } from "../state";

/** One question at a time (‹ 1 / 3 ›); Skip dismisses the card and ends the turn. */
export function QuestionCard({
  question,
  onAnswer,
  onSkip,
}: {
  question: PendingQuestion;
  onAnswer(answers: string[][]): void;
  onSkip(): void;
}) {
  const { questions } = question;
  const [drafts, setDrafts] = useState(() => emptyDrafts(questions));
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(false);
  const q = questions[index]!;
  const draft = drafts[index]!;
  const total = questions.length;
  const last = index === total - 1;

  const send = (ready: string[][]) => {
    if (sent) return;
    setSent(true);
    onAnswer(ready);
  };
  const change = (next: Draft) => setDrafts((all) => all.map((d, j) => (j === index ? next : d)));
  const submit = () => {
    const missing = firstUnanswered(questions, drafts);
    if (missing >= 0) return setIndex(missing);
    const ready = answersOf(questions, drafts);
    if (ready) send(ready);
  };
  const forward = () => (last ? submit() : setIndex(index + 1));
  const choose = (k: number) => {
    const next = pick(q, draft, k);
    change(next);
    if (q.multiple) return;
    if (total === 1) return send([answerOf(q, next)]);
    if (!last) setIndex(index + 1);
  };

  return (
    <div className="card question" role="dialog" aria-label="question">
      <div className="question-head">
        <div className="card-title">
          {q.question}
          {q.multiple ? <span className="question-hint"> · pick any</span> : null}
        </div>
        {total > 1 ? (
          <div className="question-pager">
            <button type="button" aria-label="Previous question" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
              ‹
            </button>
            <span>
              {index + 1} / {total}
            </span>
            <button type="button" aria-label="Next question" disabled={last} onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>
              ›
            </button>
          </div>
        ) : null}
      </div>
      <div className="question-options">
        {q.options.map((o, k) => (
          <button
            type="button"
            key={`${index}-${k}`}
            className={draft.picked.includes(k) ? "question-option picked" : "question-option"}
            aria-pressed={draft.picked.includes(k)}
            disabled={sent}
            onClick={() => choose(k)}
          >
            <span className="question-key">{k + 1}</span>
            {o}
          </button>
        ))}
      </div>
      <input
        key={index}
        className="question-other"
        placeholder="Or type your own answer"
        value={draft.other}
        disabled={sent}
        onChange={(e) => change(typeOther(q, draft, e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && answerOf(q, draft).length > 0) {
            e.preventDefault();
            forward();
          }
        }}
      />
      <div className="card-actions">
        <button
          type="button"
          disabled={sent}
          onClick={() => {
            setSent(true);
            onSkip();
          }}
        >
          Skip
        </button>
        <span className="question-spacer" />
        <button
          type="button"
          className="primary"
          disabled={sent || answerOf(q, draft).length === 0}
          onClick={forward}
        >
          {last ? "Submit" : "Next"}
        </button>
      </div>
    </div>
  );
}
