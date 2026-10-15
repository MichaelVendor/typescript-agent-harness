import type { WorkspaceView } from "@typescript-agent-harness/cli";
import { useEffect, useRef, useState, type MouseEvent as ClickEvent } from "react";
import { flatSessions, label, searchSessions, shownSessions, splitMatch, type Item } from "../sidebar-view";

type Flag = "pinned" | "archived";
type GroupBy = "workspace" | "flat";

/** Sessions a folder shows before "Show N more". */
const FOLDER_LIMIT = 5;
const COLLAPSED = "tah.collapsedWorkspaces";
const RAIL = "tah.sidebarRail";
const GROUP = "tah.sidebarGroup";

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

export const ChevronIcon = (props: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
    style={{ transform: props.open ? "rotate(90deg)" : undefined, transition: "transform 0.12s" }}
  >
    <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);

const DotsIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
    <circle cx="3.5" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="12.5" cy="8" r="1.2" />
  </svg>
);

const FolderPlusIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <path d="M1.5 4V12.5h7M1.5 4V3h4.5l1.5 1.5h7v4M12 10v5M9.5 12.5h5" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

const PanelIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
    <path d="M6 2.5v11" />
  </svg>
);

const ComposeIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <path
      d="M13.5 8.5v4a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12.5V4A1.5 1.5 0 0 1 4 2.5h4M11.5 1.8l2.7 2.7L8.5 10.2H5.8V7.5z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" strokeLinecap="round" />
  </svg>
);

const ViewIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" strokeLinecap="round" />
  </svg>
);

export const GearIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
    <circle cx="8" cy="8" r="2.2" />
    <path
      d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
      strokeLinecap="round"
    />
    <circle cx="8" cy="8" r="4.6" />
  </svg>
);

type Menu =
  | { kind: "session"; item: Item; x: number; y: number }
  | { kind: "folder"; ws: WorkspaceView; x: number; y: number }
  | { kind: "add"; x: number; y: number }
  | { kind: "view"; x: number; y: number };

/** Where a menu opens under (or beside, on the rail) the button that was clicked. */
function below(e: ClickEvent<HTMLElement>, beside = false) {
  const r = e.currentTarget.getBoundingClientRect();
  return beside
    ? { x: r.right + 6, y: Math.min(r.top, innerHeight - 120) }
    : { x: Math.min(r.left, innerWidth - 190), y: r.bottom + 4 };
}

export function Sidebar(props: {
  workspaces: WorkspaceView[] | undefined;
  /** Why the list is unavailable (e.g. --no-persist). */
  unavailable: string | undefined;
  current: string;
  busy: boolean;
  /** Why the current session is waiting on the user ("needs approval", "needs answer"), if it is. */
  waiting: string | undefined;
  onNew(cwd?: string): void;
  onFork(id: string, cwd?: string): void;
  onPick(id: string, cwd: string): void;
  onRename(id: string, title: string, cwd: string): Promise<void>;
  onFlag(id: string, flag: Flag, on: boolean, cwd: string): void;
  onOpenProject(): void;
  onNewFolder(): void;
  onRemoveFolder(path: string): void;
  user: string | undefined;
  onSettings(): void;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<Menu>();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL) === "1");
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (localStorage.getItem(GROUP) === "flat" ? "flat" : "workspace"));
  /** `undefined` = search closed. */
  const [query, setQuery] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const toggle = (dir: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(dir) ? prev.filter((d) => d !== dir) : [...prev, dir];
      localStorage.setItem(COLLAPSED, JSON.stringify(next));
      return next;
    });

  const setRailOn = (on: boolean) => {
    localStorage.setItem(RAIL, on ? "1" : "0");
    setRail(on);
  };

  const pickGroup = (g: GroupBy) => {
    localStorage.setItem(GROUP, g);
    setGroupBy(g);
  };

  const openSearch = () => {
    setRailOn(false);
    setQuery((q) => q ?? "");
  };

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const searching = query !== undefined;
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const menuOpen = Boolean(menu);
  useEffect(() => {
    if (!menuOpen) return;
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
    const waiting = isCurrent ? props.waiting : undefined;
    return (
      <li
        key={keyOf(item)}
        className={isCurrent ? "session-item current" : "session-item"}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: "session", item, x: Math.min(e.clientX, innerWidth - 180), y: Math.min(e.clientY, innerHeight - 200) });
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
            <span className="session-status">
              {waiting ? (
                <span className="status-dot" aria-label={waiting} />
              ) : isCurrent && props.busy ? (
                <span className="spinner" aria-label="running" />
              ) : null}
            </span>
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
              <span className="preview">
                {splitMatch(label(s), query ?? "").map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
              </span>
            </button>
            {waiting ? <span className="session-badge">{waiting}</span> : null}
            {showFolder ? <span className="session-folder">{item.ws.name}</span> : null}
            {waiting ? null : <span className="session-time">{ago(s.updatedAt)}</span>}
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
    fn();
  };

  const folder = (ws: WorkspaceView) => {
    const closed = collapsed.includes(ws.path);
    const open = expanded.includes(ws.path);
    const list = ws.sessions.filter((s) => !s.archived && !s.pinned);
    const shown = shownSessions(list, { limit: FOLDER_LIMIT, expanded: open, current: ws.active ? props.current : "" });
    const more = open ? list.length > FOLDER_LIMIT : shown.hidden > 0;
    return (
      <section key={ws.path} className="ws">
        <div className={`ws-head${ws.active ? " active" : ""}${ws.missing ? " missing" : ""}`} title={ws.path}>
          <button type="button" className="ws-toggle" aria-expanded={!closed} onClick={() => toggle(ws.path)}>
            <span className="ws-chevron">
              <ChevronIcon open={!closed} />
            </span>
            <span className="ws-name">{ws.name}</span>
          </button>
          {ws.missing ? <span className="ws-note">folder not found</span> : null}
          <span className="ws-tools">
            {ws.missing ? null : (
              <button type="button" title="New session" aria-label={`New session in ${ws.name}`} disabled={props.busy} onClick={() => props.onNew(ws.path)}>
                <PlusIcon />
              </button>
            )}
            {ws.active ? null : (
              <button
                type="button"
                title="More"
                aria-label={`More for ${ws.name}`}
                aria-haspopup="menu"
                onClick={(e) => setMenu({ kind: "folder", ws, ...below(e) })}
              >
                <DotsIcon />
              </button>
            )}
          </span>
        </div>
        {closed ? null : (
          <>
            {ws.error ? <div className="sidebar-note">{ws.error}</div> : null}
            <ul>{shown.rows.map((session) => row({ session, ws }, false))}</ul>
            {more ? (
              <button
                type="button"
                className="ws-more"
                onClick={() => setExpanded((prev) => (open ? prev.filter((p) => p !== ws.path) : [...prev, ws.path]))}
              >
                {open ? "Show less" : `Show ${shown.hidden} more`}
              </button>
            ) : null}
          </>
        )}
      </section>
    );
  };

  const results = searchSessions(all, query ?? "");

  const footer =
    props.user !== undefined ? (
      <div className="sidebar-user">
        <span className="avatar" aria-hidden>
          {(props.user[0] ?? "?").toUpperCase()}
        </span>
        <span className="user-name">{props.user}</span>
        <button type="button" className="icon-btn" title="Settings" aria-label="Settings" onClick={props.onSettings}>
          <GearIcon />
        </button>
      </div>
    ) : null;

  return (
    <aside className={rail ? "sidebar rail" : "sidebar"}>
      {rail ? (
        <>
          <span className="brand-mark" aria-hidden>
            t
          </span>
          <button type="button" className="rail-btn" title="Expand sidebar" aria-label="Expand sidebar" onClick={() => setRailOn(false)}>
            <PanelIcon />
          </button>
          <button type="button" className="rail-btn" title="New session" aria-label="New session" disabled={props.busy} onClick={() => props.onNew()}>
            <ComposeIcon />
          </button>
          <button type="button" className="rail-btn" title="Search" aria-label="Search sessions" onClick={openSearch}>
            <SearchIcon />
          </button>
          <button
            type="button"
            className="rail-btn"
            title="Add workspace"
            aria-label="Add workspace"
            aria-haspopup="menu"
            disabled={props.busy}
            onClick={(e) => setMenu({ kind: "add", ...below(e, true) })}
          >
            <FolderPlusIcon />
          </button>
          <span className="rail-gap" />
          {props.user !== undefined ? (
            <button type="button" className="rail-btn" title="Settings" aria-label="Settings" onClick={props.onSettings}>
              <GearIcon />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="sidebar-brand">
            <span className="brand">
              <span className="brand-mark" aria-hidden>
                t
              </span>
              tah
            </span>
            <button type="button" className="icon-btn" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={() => setRailOn(true)}>
              <PanelIcon />
            </button>
          </div>
          <button type="button" className="new-session" onClick={() => props.onNew()} disabled={props.busy}>
            <ComposeIcon />
            New session
          </button>
          {query !== undefined ? (
            <div className="sidebar-search">
              <SearchIcon />
              <input
                ref={searchRef}
                value={query}
                placeholder="Search sessions"
                aria-label="Search sessions"
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => !query.trim() && setQuery(undefined)}
                onKeyDown={(e) => e.key === "Escape" && setQuery(undefined)}
              />
              <button type="button" className="icon-btn" title="Clear" aria-label="Clear search" onClick={() => setQuery(undefined)}>
                <CloseIcon />
              </button>
            </div>
          ) : (
            <div className="ws-header">
              <span>{groupBy === "flat" ? "Sessions" : "Workspaces"}</span>
              <span className="ws-header-tools">
                <button type="button" className="icon-btn" title="Search" aria-label="Search sessions" onClick={openSearch}>
                  <SearchIcon />
                </button>
                <button
                  type="button"
                  className={menu?.kind === "view" ? "icon-btn on" : "icon-btn"}
                  title="View options"
                  aria-label="View options"
                  aria-haspopup="menu"
                  onClick={(e) => setMenu({ kind: "view", ...below(e) })}
                >
                  <ViewIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Add workspace"
                  aria-label="Add workspace"
                  aria-haspopup="menu"
                  disabled={props.busy}
                  onClick={(e) => setMenu({ kind: "add", ...below(e) })}
                >
                  <FolderPlusIcon />
                </button>
              </span>
            </div>
          )}
          {props.unavailable ? <div className="sidebar-note">{props.unavailable}</div> : null}
          <div className="sessions">
            {query !== undefined ? (
              query.trim() ? (
                <>
                  <ul>{results.map((i) => row(i, true))}</ul>
                  <div className="sidebar-note">
                    {results.length ? `${results.length} session${results.length === 1 ? "" : "s"}` : "No matches"} · titles and
                    folder names
                  </div>
                </>
              ) : null
            ) : (
              <>
                {pinned.length ? (
                  <>
                    <div className="sessions-heading">Pinned</div>
                    <ul>{pinned.map((i) => row(i, true))}</ul>
                  </>
                ) : null}
                {groupBy === "flat" ? <ul>{flatSessions(all).map((i) => row(i, true))}</ul> : all.map(folder)}
              </>
            )}
          </div>
          {footer}
        </>
      )}
      {menu?.kind === "session" ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={act(() => props.onFlag(menu.item.session.id, "pinned", !menu.item.session.pinned, menu.item.ws.path))}
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
            <button type="button" role="menuitem" onClick={act(() => void navigator.clipboard?.writeText(menu.item.session.id))}>
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
      {menu?.kind === "folder" ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <li>
            <button type="button" role="menuitem" onClick={act(() => props.onRemoveFolder(menu.ws.path))}>
              Remove from list
            </button>
          </li>
        </ul>
      ) : null}
      {menu?.kind === "add" ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
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
      {menu?.kind === "view" ? (
        <ul ref={menuRef} className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <li className="menu-label">Group by</li>
          {(
            [
              ["workspace", "Workspace"],
              ["flat", "One list"],
            ] as const
          ).map(([g, text]) => (
            <li key={g}>
              <button type="button" role="menuitemradio" aria-checked={groupBy === g} onClick={act(() => pickGroup(g))}>
                <span className="menu-check">{groupBy === g ? "✓" : ""}</span>
                {text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
