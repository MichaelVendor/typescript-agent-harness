import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DELIVER_TEXT_MAX = 2000;

export type DeliverItem = { fromSessionId: string; fromTitle?: string; text: string; at: number };

type DeliverStore = Record<string, DeliverItem[]>;

export class DeliverValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliverValidationError";
  }
}

export function deliverPath(cwd: string): string {
  return path.join(path.resolve(cwd), ".tah", "session-delivers.json");
}

export function isSelfDeliver(toSessionId: string, fromSessionId: string): boolean {
  return toSessionId === fromSessionId;
}

export function validateDeliverText(text: unknown): string {
  if (typeof text !== "string") throw new DeliverValidationError("text must be a string");
  const trimmed = text.trim();
  if (!trimmed) throw new DeliverValidationError("text must be non-empty");
  if (trimmed.length > DELIVER_TEXT_MAX) {
    throw new DeliverValidationError(`text must be at most ${DELIVER_TEXT_MAX} characters`);
  }
  return trimmed;
}

export function formatDeliverNotice(item: DeliverItem): string {
  const label = item.fromTitle?.trim() || item.fromSessionId;
  return `[from «${label}»] ${item.text}`;
}

function loadStore(cwd: string): DeliverStore {
  const file = deliverPath(cwd);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: DeliverStore = {};
    for (const [id, items] of Object.entries(raw)) {
      if (!Array.isArray(items)) continue;
      const parsed: DeliverItem[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Partial<DeliverItem>;
        if (typeof row.fromSessionId !== "string" || typeof row.text !== "string" || typeof row.at !== "number") continue;
        parsed.push({
          fromSessionId: row.fromSessionId,
          text: row.text,
          at: row.at,
          ...(typeof row.fromTitle === "string" && row.fromTitle.trim() ? { fromTitle: row.fromTitle.trim() } : {}),
        });
      }
      if (parsed.length) out[id] = parsed;
    }
    return out;
  } catch {
    return {};
  }
}

function saveStore(cwd: string, store: DeliverStore): void {
  const file = deliverPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

export function enqueueDeliver(cwd: string, toSessionId: string, item: DeliverItem): void {
  const store = loadStore(cwd);
  const list = store[toSessionId] ?? [];
  list.push(item);
  store[toSessionId] = list;
  saveStore(cwd, store);
}

export function drainDelivers(cwd: string, sessionId: string): DeliverItem[] {
  const store = loadStore(cwd);
  const items = store[sessionId] ?? [];
  if (!items.length) return [];
  delete store[sessionId];
  saveStore(cwd, store);
  return items;
}