import { useState } from "react";
import type { Todo } from "@typescript-agent-harness/cli";
import { ChevronIcon } from "./Sidebar";

const MARK = { completed: "☑", in_progress: "▶", pending: "☐" } as const;

/** The agent's task list above the composer; hidden once every item is done. */
export function TodoPanel({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(true);
  const done = todos.filter((t) => t.status === "completed").length;
  if (done === todos.length) return null;
  const current = todos.find((t) => t.status === "in_progress");
  return (
    <div className="todos">
      <button type="button" className="todos-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon open={open} />
        <span className="todos-title">
          Tasks {done}/{todos.length}
        </span>
        {!open && current ? <span className="todos-current">{current.content}</span> : null}
      </button>
      {open ? (
        <ul className="todos-list">
          {todos.map((t, i) => (
            <li key={i} className={t.status}>
              <span className="todos-mark">{MARK[t.status]}</span>
              {t.content}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
