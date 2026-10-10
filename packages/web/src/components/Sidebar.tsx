import type { SessionRow } from "@typescript-agent-harness/cli";

function time(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button onClick={props.onNew} disabled={props.busy}>
          New session
        </button>
        <button onClick={props.onFork} disabled={props.busy || !props.current}>
          Fork
        </button>
      </div>
      {props.unavailable ? <div className="sidebar-note">{props.unavailable}</div> : null}
      <ul className="sessions">
        {(props.sessions ?? []).map((s) => (
          <li key={s.id}>
            <button
              className={s.id === props.current ? "session current" : "session"}
              disabled={props.busy && s.id !== props.current}
              onClick={() => s.id !== props.current && props.onPick(s.id)}
              title={s.id}
            >
              <span className="preview">{s.preview || "(empty)"}</span>
              <span className="meta">
                {s.turns} turns · {time(s.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
