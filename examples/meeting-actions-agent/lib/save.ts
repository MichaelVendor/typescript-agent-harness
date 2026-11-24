import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionBatch } from "./confirm.ts";
import { composeDraft } from "./compose.ts";

export const PROJECT_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

function actionStamp(iso: string): string {
  return iso.replaceAll(":", "-").replaceAll(".", "-");
}

function resolveOutRoot(outDir?: string): string {
  return outDir ?? path.join(PROJECT_ROOT, "out");
}

function hasUnownedActions(batch: ActionBatch): boolean {
  return batch.rows.some((r) => r.kind === "action" && r.owner === null);
}

export type TaskRecord = {
  ts: string;
  rowIds: string[];
  jsonPath: string;
  mdPath: string;
  rowCount: number;
  meetingTitle?: string;
};

export function saveActions(
  batch: ActionBatch,
  opts?: { allowUnowned?: boolean; outDir?: string; now?: Date },
): { mdPath: string; jsonPath: string } {
  if (!batch.confirmed) {
    throw new Error("not confirmed");
  }
  if (hasUnownedActions(batch) && !opts?.allowUnowned) {
    throw new Error("unowned actions");
  }

  const now = opts?.now ?? new Date();
  const ts = now.toISOString();
  const outRoot = resolveOutRoot(opts?.outDir);
  const actionsDir = path.join(outRoot, "actions");
  mkdirSync(actionsDir, { recursive: true });

  const stamp = actionStamp(ts);
  const jsonPath = path.join(actionsDir, `${stamp}.json`);
  const mdPath = path.join(actionsDir, `${stamp}.md`);

  const { markdown } = composeDraft(batch);
  writeFileSync(jsonPath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, markdown, "utf8");

  const tasksPath = path.join(outRoot, "tasks.jsonl");
  mkdirSync(path.dirname(tasksPath), { recursive: true });
  const record: TaskRecord = {
    ts,
    rowIds: batch.rows.map((r) => r.id),
    jsonPath,
    mdPath,
    rowCount: batch.rows.length,
    ...(batch.meetingTitle !== undefined ? { meetingTitle: batch.meetingTitle } : {}),
  };
  appendFileSync(tasksPath, `${JSON.stringify(record)}\n`, "utf8");

  return { mdPath, jsonPath };
}