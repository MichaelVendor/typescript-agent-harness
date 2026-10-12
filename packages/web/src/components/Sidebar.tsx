import type { SessionRow, WorkspaceView } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState } from "react";

type Flag = "pinned" | "archived";
type Item = { session: SessionRow; ws: WorkspaceView };

const COLLAPSED = "tah.collapsedWorkspaces";
function loadCollapsed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

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

const FolderPlusIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <path d="M1.5 4V12.5h7M1.5 4V3h4.5l1.5 1.5h7v4M12 10v5M9.5 12.5h5" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

export function Sidebar(props: {
  workspaces: WorkspaceView[] | undefined;
  /** Why the list is unavailable (e.g. --no-persist). */
  unavailable: string | undefined;
  current: string;
  busy: boolean;
  onNew(cwd?: string): void;
  onFork(id: string, cwd?: string): void;
  onPick(id: string, cwd: string): void;
  onRename(id: string, title: string, cwd: string): Promise<void>;
  onFlag(id: string, flag: Flag, on: boolean, cwd: string): void;
  onOpenProject(): void;
  onNewFolder(): void;
  onRemoveFolder(path: string): void;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ item: Item; x: number; y: number }>();
  const [addMenu, setAddMenu] = useState<{ x: number; y: number }>();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(dir) ? prev.filter((d) => d !== dir) : [...prev, dir];
      localStorage.setItem(COLLAPSED, JSON.stringify(next));
      return next;
    });

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const menuOpen = Boolean(menu || addMenu);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenu(undefined);
      setAddMenu(undefined);
    };
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
  }, [menuOpen]);

  const keyOf = (item: Item) => `${item.ws.path}\n${item.session.id}`;

  const startEdit = (item: Item) => {
    if (props.busy) return;
    setEditing(keyOf(item));
    setDraft(label(item.session));
  };

  const commit = async (item: Item) => {
    const title = draft;
    setEditing(undefined);
    await props.onRename(item.session.id, title, item.ws.path);
  };

  const all = props.workspaces ?? [];
  const items = (ws: WorkspaceView) => ws.sessions.filter((s) => !s.archived).map((session) => ({ session, ws }));
  const pinned = all.flatMap(items).filter((i) => i.session.pinned);

  const row = (item: Item, showFolder: boolean) => {
    const s = item.session;
    const isCurrent = item.ws.active && s.id === props.current;
    return (
      <li
        key={keyOf(item)}
        className={isCurrent ? "session-item current" : "session-item"}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ item, x: Math.min(e.clientX, innerWidth - 180), y: Math.min(e.clientY, innerHeight - 200) });
        }}
      >
        {editing === keyOf(item) ? (
          <form
            className="session editing"
            onSubmit={(e) => {
              e.preventDefault();
              void commit(item);
            }}
          >
            <input
              ref={inputRef}
              className="session-rename"
              value={draft}
              aria-label="Rename session"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit(item)}
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
              disabled={props.busy && !isCurrent}
              onClick={() => !isCurrent && props.onPick(s.id, item.ws.path)}
              onDoubleClick={(e) => {
                e.preventDefault();
                startEdit(item);
              }}
              title={`${s.id}\n${s.turns} turns · ${time(s.updatedAt)}\nDouble-click to rename`}
            >
              <span className="preview">{label(s)}</span>
            </button>
            {showFolder ? <span className="session-folder">{item.ws.name}</span> : null}
            <span className="session-time">{ago(s.updatedAt)}</span>
            <span className="session-tools">
              <button
                type="button"
                aria-label={s.pinned ? "Unpin" : "Pin"}
                title={s.pinned ? "Unpin" : "Pin"}
                className={s.pinned ? "on" : undefined}
                onClick={() => props.onFlag(s.id, "pinned", !s.pinned, item.ws.path)}
              >
                <PinIcon />
              </button>
              <button
                type="button"
                aria-label="Archive"
                title="Archive"
                onClick={() => props.onFlag(s.id, "archived", true, item.ws.path)}
              >
                <ArchiveIcon />
              </button>
            </span>
          </div>
        )}
      </li>
    );
  };

  const act = (fn: () => void) => () => {
    setMenu(undefined);
    setAddMenu(undefined);
    fn();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button type="button" onClick={() => props.onNew()} disabled={props.busy}>
          New session
        </button>
        <button type="button" onClick={() => props.onFork(props.current)} disabled={props.busy || !props.current}>
          Fork
        </button>
      </div>
      <div className="ws-header">
        <span>Workspaces</span>
        <button
          type="button"
          className="icon-btn"
          title="Add workspace"
          aria-label="Add workspace"
          aria-haspopup="menu"
          disabled={props.busy}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAddMenu({ x: Math.min(r.left, innerWidth - 180), y: r.bottom + 4 });
          }}
        >
          <FolderPlusIcon />
        </button>
      </div>
      {props.unavailable ? <div className="sidebar-note">{props.unavailable}</div> : null}
      <div className="sessions">
        {pinned.length ? (
          <>
            <div className="sessions-heading">Pinned</div>
            <ul>{pinned.map((i) => row(i, true))}</ul>
          </>
        ) : null}
        {all.map((ws) => {
          const closed = collapsed.includes(ws.path);
          return (
            <section key={ws.path} className="ws">
              <div className={`ws-head${ws.active ? " active" : ""}${ws.missing ? " missing" : ""}`} title={ws.path}>
                <button type="button" className="ws-toggle" aria-expanded={!closed} onClick={() => toggle(ws.path)}>
                  <span className="ws-chevron">{closed ? "▸" : "▾"}</span>
                  <span className="ws-name">{ws.name}</span>
                </button>
                {ws.missing ? <span className="ws-note">folder not found</span> : null}
                <span className="ws-tools">
                  {ws.missing ? null : (
                    <button type="button" title="New session" aria-label={`New session in ${ws.name}`} disabled={props.busy} onClick={() => props.onNew(ws.path)}>
                      +
                    </button>
                  )}
                  {ws.active ? null : (
                    <button type="button" title="Remove from list" aria-label={`Remove ${ws.name}`} onClick={() => props.onRemoveFolder(ws.path)}>
                      ×
                    </button>
                  )}
                </span>
              </div>
              {closed ? null : (
                <>
                  {ws.error ? <div className="sidebar-note">{ws.error}</div> : null}
                  <ul>{items(ws).filter((i) => !i.session.pinned).map((i) => row(i, false))}</ul>
                </>
              )}
            </section>
          );
        })}
      </div>
      {menu ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() =>
                props.onFlag(menu.item.session.id, "pinned", !menu.item.session.pinned, menu.item.ws.path),
              )}
            >
              {menu.item.session.pinned ? "Unpin" : "Pin"}
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" disabled={props.busy} onClick={act(() => startEdit(menu.item))}>
              Rename
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              disabled={props.busy}
              onClick={act(() => props.onFork(menu.item.session.id, menu.item.ws.path))}
            >
              Fork
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => void navigator.clipboard?.writeText(menu.item.session.id))}
            >
              Copy ID
            </button>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => props.onFlag(menu.item.session.id, "archived", true, menu.item.ws.path))}
            >
              Archive
            </button>
          </li>
        </ul>
      ) : null}
      {addMenu ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: addMenu.x, top: addMenu.y }}>
          <li>
            <button type="button" role="menuitem" onClick={act(props.onOpenProject)}>
              Open project…
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" onClick={act(props.onNewFolder)}>
              New folder…
            </button>
          </li>
        </ul>
      ) : null}
    </aside>
  );
}
