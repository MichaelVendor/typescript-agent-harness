import type { SessionRow } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState } from "react";

type Flag = "pinned" | "archived";

function time(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ago(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function label(s: SessionRow): string {
  return s.title?.trim() || s.preview || "New chat";
}

const PinIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M6 2h4l-.5 4 2.5 2.5v1H4v-1L6.5 6 6 2zM8 9.5V14" strokeLinejoin="round" />
  </svg>
);

const ArchiveIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M2 3h12v3H2zM3 6v7h10V6M6.5 8.5h3" strokeLinejoin="round" />
  </svg>
);

export function Sidebar(props: {
  sessions: SessionRow[] | undefined;
  /** Why the list is unavailable (e.g. --no-persist). */
  unavailable: string | undefined;
  current: string;
  busy: boolean;
  onNew(): void;
  onFork(id: string): void;
  onPick(id: string): void;
  onRename(id: string, title: string): Promise<void>;
  onFlag(id: string, flag: Flag, on: boolean): void;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ session: SessionRow; x: number; y: number }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const startEdit = (s: SessionRow) => {
    if (props.busy) return;
    setEditing(s.id);
    setDraft(label(s));
  };

  const commit = async (id: string) => {
    const title = draft;
    setEditing(undefined);
    await props.onRename(id, title);
  };

  const visible = (props.sessions ?? []).filter((s) => !s.archived);
  const pinned = visible.filter((s) => s.pinned);
  const rest = visible.filter((s) => !s.pinned);

  const row = (s: SessionRow) => (
    <li
      key={s.id}
      className={s.id === props.current ? "session-item current" : "session-item"}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ session: s, x: Math.min(e.clientX, innerWidth - 180), y: Math.min(e.clientY, innerHeight - 200) });
      }}
    >
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
        </form>
      ) : (
        <div className="session">
          <button
            type="button"
            className="session-pick"
            disabled={props.busy && s.id !== props.current}
            onClick={() => s.id !== props.current && props.onPick(s.id)}
            onDoubleClick={(e) => {
              e.preventDefault();
              startEdit(s);
            }}
            title={`${s.id}\n${s.turns} turns · ${time(s.updatedAt)}\nDouble-click to rename`}
          >
            <span className="preview">{label(s)}</span>
          </button>
          <span className="session-time">{ago(s.updatedAt)}</span>
          <span className="session-tools">
            <button
              type="button"
              aria-label={s.pinned ? "Unpin" : "Pin"}
              title={s.pinned ? "Unpin" : "Pin"}
              className={s.pinned ? "on" : undefined}
              onClick={() => props.onFlag(s.id, "pinned", !s.pinned)}
            >
              <PinIcon />
            </button>
            <button type="button" aria-label="Archive" title="Archive" onClick={() => props.onFlag(s.id, "archived", true)}>
              <ArchiveIcon />
            </button>
          </span>
        </div>
      )}
    </li>
  );

  const act = (fn: () => void) => () => {
    setMenu(undefined);
    fn();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button type="button" onClick={props.onNew} disabled={props.busy}>
          New session
        </button>
        <button type="button" onClick={() => props.onFork(props.current)} disabled={props.busy || !props.current}>
          Fork
        </button>
      </div>
      {props.unavailable ? <div className="sidebar-note">{props.unavailable}</div> : null}
      <div className="sessions">
        {pinned.length ? (
          <>
            <div className="sessions-heading">Pinned</div>
            <ul>{pinned.map(row)}</ul>
            <div className="sessions-heading">Sessions</div>
          </>
        ) : null}
        <ul>{rest.map(row)}</ul>
      </div>
      {menu ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => props.onFlag(menu.session.id, "pinned", !menu.session.pinned))}
            >
              {menu.session.pinned ? "Unpin" : "Pin"}
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" disabled={props.busy} onClick={act(() => startEdit(menu.session))}>
              Rename
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" disabled={props.busy} onClick={act(() => props.onFork(menu.session.id))}>
              Fork
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => void navigator.clipboard?.writeText(menu.session.id))}
            >
              Copy ID
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => props.onFlag(menu.session.id, "archived", true))}
            >
              Archive
            </button>
          </li>
        </ul>
      ) : null}
    </aside>
  );
}
