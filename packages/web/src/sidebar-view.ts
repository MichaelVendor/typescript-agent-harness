import type { SessionRow, WorkspaceView } from "@typescript-agent-harness/cli";

export type Item = { session: SessionRow; ws: WorkspaceView };

export function label(s: SessionRow): string {
  return s.title?.trim() || s.preview || "New chat";
}

const newestFirst = (a: Item, b: Item) => b.session.updatedAt - a.session.updatedAt;

function live(all: WorkspaceView[]): Item[] {
  return all.flatMap((ws) => ws.sessions.filter((s) => !s.archived).map((session) => ({ session, ws })));
}

/** Sessions whose title or folder name contains `query`, across folders. */
export function searchSessions(all: WorkspaceView[], query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return live(all)
    .filter((i) => label(i.session).toLowerCase().includes(q) || i.ws.name.toLowerCase().includes(q))
    .sort(newestFirst);
}

/** Every folder's unpinned sessions in one list (pinned ones have their own section). */
export function flatSessions(all: WorkspaceView[]): Item[] {
  return live(all)
    .filter((i) => !i.session.pinned)
    .sort(newestFirst);
}

export function splitMatch(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) parts.push({ text: text.slice(at, i), hit: false });
    parts.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** A folder's first `limit` sessions, plus the current one if it sits further down. */
export function shownSessions(
  rows: SessionRow[],
  o: { limit: number; expanded: boolean; current: string },
): { rows: SessionRow[]; hidden: number } {
  if (o.expanded || rows.length <= o.limit) return { rows, hidden: 0 };
  const shown = rows.slice(0, o.limit);
  const current = rows.slice(o.limit).find((r) => r.id === o.current);
  if (current) shown.push(current);
  return { rows: shown, hidden: rows.length - shown.length };
}
