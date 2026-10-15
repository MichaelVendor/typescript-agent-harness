import { useState } from "react";
import { answersOf, emptyDrafts, pick, typeOther } from "../question-view";
import type { PendingQuestion } from "../state";

export function QuestionCard({ question, onAnswer }: { question: PendingQuestion; onAnswer(answers: string[][]): void }) {
  const { questions } = question;
  const [drafts, setDrafts] = useState(() => emptyDrafts(questions));
  const [sent, setSent] = useState(false);
  const answers = answersOf(questions, drafts);
  const submit = (ready = answers) => {
    if (!ready || sent) return;
    setSent(true);
    onAnswer(ready);
  };
  const quick = questions.length === 1 && !questions[0]!.multiple;

  return (
    <div className="card question" role="dialog" aria-label="question">
      {questions.map((q, i) => {
        const draft = drafts[i]!;
        const change = (next: typeof draft) => setDrafts((all) => all.map((d, j) => (j === i ? next : d)));
        return (
          <div className="question-item" key={i}>
            <div className="card-title">
              {q.question}
              {q.multiple ? <span className="question-hint"> · pick any</span> : null}
            </div>
            <div className="question-options">
              {q.options.map((o, k) => (
                <button
                  type="button"
                  key={k}
                  className={draft.picked.includes(k) ? "question-option picked" : "question-option"}
                  aria-pressed={draft.picked.includes(k)}
                  disabled={sent}
                  onClick={() => {
                    const next = pick(q, draft, k);
                    change(next);
                    if (quick) submit([[o]]);
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
            <input
              className="question-other"
              placeholder={quick ? "Or type your own answer and press Enter" : "Or type your own answer"}
              value={draft.other}
              disabled={sent}
              onChange={(e) => change(typeOther(q, draft, e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        );
      })}
      {quick ? null : (
        <div className="card-actions">
          <button className="primary" disabled={!answers || sent} onClick={() => submit()}>
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
