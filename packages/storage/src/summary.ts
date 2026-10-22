import type { PersistedSession, SessionSummary } from "./types.js";

/**
 * How much of `messages_json` a summary carries. The first user turn (the sidebar
 * preview) is far shorter; 64 KB leaves room for a long pasted prompt without
 * reading a multi-megabyte column.
 */
export const MESSAGE_HEAD_CHARS = 64_000;

/** Project a full row down to what a session list needs. */
export function toSummary(row: PersistedSession): SessionSummary {
  return summarize(row.id, row.status, row.maxSteps, row.messagesJson, row.createdAt, row.updatedAt);
}

export function summarize(
  id: string,
  status: string,
  maxSteps: number,
  messagesJson: string,
  createdAt: number,
  updatedAt: number,
): SessionSummary {
  return {
    id,
    status,
    maxSteps,
    messagesHead: messagesJson.slice(0, MESSAGE_HEAD_CHARS),
    messagesChars: messagesJson.length,
    createdAt,
    updatedAt,
  };
}

/** `head` may be a truncated prefix, so a parse failure is a truncated transcript, not a broken db. */
export function isTruncated(summary: SessionSummary): boolean {
  return summary.messagesChars > summary.messagesHead.length;
}
