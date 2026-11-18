/**
 * Serve 旁路：从 Super-agent persistDir 读 panel.json（只读，不跑 Router/Worker）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReviewPanelSnapshot } from "@typescript-agent-harness/agent";

function isTicketLike(row: unknown): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const t = row as Record<string, unknown>;
  return typeof t.id === "string" && typeof t.goal === "string" && typeof t.status === "string";
}

export function readSuperAgentPanel(persistDir: string): ReviewPanelSnapshot {
  const file = path.join(persistDir, "panel.json");
  if (!existsSync(file)) throw new Error(`no panel.json in ${persistDir}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("panel.json is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("panel.json must be an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.agentId !== "string" || typeof o.status !== "string") {
    throw new Error("panel.json missing agentId/status");
  }
  if (!Array.isArray(o.needsHuman) || !Array.isArray(o.running)) {
    throw new Error("panel.json needsHuman/running must be arrays");
  }
  if (!o.needsHuman.every(isTicketLike) || !o.running.every(isTicketLike)) {
    throw new Error("panel.json tickets malformed");
  }
  const recentReplies = Array.isArray(o.recentReplies)
    ? o.recentReplies.filter((r): r is string => typeof r === "string")
    : [];
  const subscriptions = Array.isArray(o.subscriptions)
    ? o.subscriptions.flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const row = s as Record<string, unknown>;
        if (typeof row.threadId !== "string" || typeof row.ticketId !== "string") return [];
        return [{ threadId: row.threadId, ticketId: row.ticketId }];
      })
    : [];
  return {
    agentId: o.agentId,
    status: o.status as ReviewPanelSnapshot["status"],
    needsHuman: o.needsHuman as ReviewPanelSnapshot["needsHuman"],
    running: o.running as ReviewPanelSnapshot["running"],
    recentReplies,
    subscriptions,
  };
}
