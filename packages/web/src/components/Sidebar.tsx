import type { SessionRow } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

function time(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function label(s: SessionRow): string {
  return s.title?.trim() || s.preview || "New chat";
}

export function Sidebar(props: {
  sessions: SessionRow[] | undefined;
  /** Why the list is unavailable (e.g. --no-persist). */
  unavailable: string | undefined;
  current: string;
  busy: boolean;
  onNew(): void;
  onFork(): void;
  onPick(id: string): void;
  onRename(id: string, title: string): Promise<void>;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = (s: SessionRow, e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.busy) return;
    setEditing(s.id);
    setDraft(label(s));
  };

  const commit = async (id: string) => {
    const title = draft;
    setEditing(undefined);
    await props.onRename(id, title);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button type="button" onClick={props.onNew} disabled={props.busy}>
          New session
        </button>
        <button type="button" onClick={props.onFork} disabled={props.busy || !props.current}>
          Fork
        </button>
      </div>
      {props.unavailable ? <div className="sidebar-note">{props.unavailable}</div> : null}
      <ul className="sessions">
        {(props.sessions ?? []).map((s) => (
          <li key={s.id} className={s.id === props.current ? "session-item current" : "session-item"}>
            {editing === s.id ? (
              <form
                className="session editing"
                onSubmit={(e) => {
                  e.preventDefault();
                  void commit(s.id);
                }}
              >
                <input
                  ref={inputRef}
                  className="session-rename"
                  value={draft}
                  aria-label="Rename session"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commit(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditing(undefined);
                    }
                  }}
                />
                <span className="meta">
                  {s.turns} turns · {time(s.updatedAt)}
                </span>
              </form>
            ) : (
              <div className="session">
                <div className="preview-row">
                  <button
                    type="button"
                    className="session-pick"
                    disabled={props.busy && s.id !== props.current}
                    onClick={() => s.id !== props.current && props.onPick(s.id)}
                    onDoubleClick={(e) => startEdit(s, e)}
                    title={`${s.id}\nDouble-click to rename`}
                  >
                    <span className="preview">{label(s)}</span>
                    <span className="meta">
                      {s.turns} turns · {time(s.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-rename-btn"
                    disabled={props.busy}
                    aria-label={`Rename ${label(s)}`}
                    title="Rename"
                    onClick={(e) => startEdit(s, e)}
                  >
                    ✎
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
