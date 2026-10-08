import type { ChatMessage } from "@typescript-agent-harness/llm";
import type { PersistedSession, StorageService } from "@typescript-agent-harness/storage";

export type SessionRow = {
  id: string;
  state: string;
  turns: number;
  updatedAt: number;
  preview: string;
};

export function toRows(rows: PersistedSession[]): SessionRow[] {
  return rows.map((row) => {
    const messages = JSON.parse(row.messagesJson) as ChatMessage[];
    const userTexts = messages.flatMap((m) => (m.role === "user" ? [m.content] : []));
    const first = (userTexts[0] ?? "").replace(/\s+/g, " ").trim();
    return {
      id: row.id,
      state: row.status,
      turns: userTexts.length,
      updatedAt: row.updatedAt,
      preview: first.length > 60 ? `${first.slice(0, 60)}…` : first,
    };
  });
}

function time(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Newest first; the number is what `--session <n>` / `/resume <n>` accept. */
export function formatSessions(rows: SessionRow[], currentId?: string): string {
  if (rows.length === 0) return "[tah] no saved sessions";
  return rows
    .map((r, i) => {
      const mark = r.id === currentId ? "*" : " ";
      return `${mark}${String(i + 1).padStart(3)}  ${r.id}  ${r.state.padEnd(9)} ${String(r.turns).padStart(3)} turns  ${time(r.updatedAt)}  ${r.preview}`;
    })
    .join("\n");
}

/** Accepts a full session id or a 1-based number from the newest-first list. */
export async function resolveSessionRef(
  storage: StorageService,
  ref: string,
): Promise<string | undefined> {
  const rows = await storage.listSessions();
  if (/^\d+$/.test(ref)) return rows[Number(ref) - 1]?.id;
  return rows.find((r) => r.id === ref)?.id;
}
