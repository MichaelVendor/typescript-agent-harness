import type { ChatMessage, ContentPart } from "@typescript-agent-harness/llm";
import {
  isTruncated,
  type SessionSummary,
  type StorageService,
} from "@typescript-agent-harness/storage";
import type { AttachmentMeta } from "./attachments/store.js";
import { parseUserContent } from "./attachments/compose.js";
import { loadSessionFlags } from "./session-flags.js";
import { loadSessionTitles } from "./session-titles.js";
import { stripSkillInjection } from "./skills/slash.js";

export type SessionRow = {
  id: string;
  state: string;
  turns: number;
  updatedAt: number;
  /** Auto title from first user turn (or attachments). */
  preview: string;
  /** Optional user-set name; UI should prefer this over `preview`. */
  title?: string;
  pinned?: true;
  archived?: true;
};

const PLACEHOLDERS = new Set(["", "(attachments)", "(attachments only)"]);

function userPayload(content: string | ContentPart[]): { text: string; attachments: AttachmentMeta[] } {
  const raw =
    typeof content === "string"
      ? content
      : content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  const parsed = parseUserContent(raw);
  return { text: stripSkillInjection(parsed.text), attachments: parsed.attachments };
}

/** Sidebar / list label: prefer real text, else attachment file names — never bare "(attachments)". */
export function sessionPreview(text: string, attachments: AttachmentMeta[] = []): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t && !PLACEHOLDERS.has(t)) return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  if (attachments.length === 1) {
    const name = attachments[0]!.name.trim() || "attachment";
    return name.length > 60 ? `${name.slice(0, 60)}…` : name;
  }
  if (attachments.length > 1) {
    const first = attachments[0]!.name.trim() || "file";
    const label = `${first} +${attachments.length - 1}`;
    return label.length > 60 ? `${label.slice(0, 60)}…` : label;
  }
  return "New chat";
}

/** Display text for the transcript; strip internal placeholders. */
export function displayUserText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return PLACEHOLDERS.has(t) ? "" : text;
}

function describe(row: SessionSummary): { preview: string; turns: number } {
  let messages: ChatMessage[];
  try {
    const parsed = JSON.parse(row.messagesHead) as unknown;
    if (!Array.isArray(parsed)) return { preview: "New chat", turns: 0 };
    messages = parsed as ChatMessage[];
  } catch {
    return { preview: isTruncated(row) ? "…" : "New chat", turns: 0 };
  }
  const users = messages.flatMap((m) => (m?.role === "user" ? [userPayload(m.content)] : []));
  const first = users[0] ?? { text: "", attachments: [] as AttachmentMeta[] };
  return { preview: sessionPreview(first.text, first.attachments), turns: users.length };
}

export function toRows(rows: SessionSummary[], cwd?: string): SessionRow[] {
  const titles = cwd !== undefined ? loadSessionTitles(cwd) : {};
  const flags = cwd !== undefined ? loadSessionFlags(cwd) : { pinned: [], archived: [] };
  const pinned = new Set(flags.pinned);
  const archived = new Set(flags.archived);
  return rows.map((row) => {
    const { preview, turns } = describe(row);
    const title = titles[row.id];
    return {
      id: row.id,
      state: row.status,
      turns,
      updatedAt: row.updatedAt,
      preview,
      ...(title !== undefined ? { title } : {}),
      ...(pinned.has(row.id) ? { pinned: true as const } : {}),
      ...(archived.has(row.id) ? { archived: true as const } : {}),
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
      const label = r.title ?? r.preview;
      return `${mark}${String(i + 1).padStart(3)}  ${r.id}  ${r.state.padEnd(9)} ${String(r.turns).padStart(3)} turns  ${time(r.updatedAt)}  ${label}`;
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
