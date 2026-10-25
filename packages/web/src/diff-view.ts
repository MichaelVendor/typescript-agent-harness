import type { Entry } from "./state";

export type FileChange = {
  id: string;
  path: string;
  kind: "write" | "edit";
  /** Full file for write_file. */
  content?: string;
  old?: string;
  next?: string;
  replaceAll?: boolean;
};

/** Successful write_file / edit_file tools that still carry their input. */
export function fileChanges(entries: Entry[]): FileChange[] {
  const out: FileChange[] = [];
  for (const e of entries) {
    if (e.kind !== "tool" || e.status !== "ok") continue;
    if (e.tool !== "write_file" && e.tool !== "edit_file") continue;
    const a = (e.input ?? {}) as Record<string, unknown>;
    const path = e.path ?? (typeof a.path === "string" ? a.path : "");
    if (!path) continue;
    if (e.tool === "write_file") {
      out.push({
        id: e.callId,
        path,
        kind: "write",
        content: typeof a.content === "string" ? a.content : "",
      });
      continue;
    }
    out.push({
      id: e.callId,
      path,
      kind: "edit",
      old: typeof a.old_string === "string" ? a.old_string : "",
      next: typeof a.new_string === "string" ? a.new_string : "",
      replaceAll: a.replace_all === true,
    });
  }
  return out;
}

/** Lines for a simple unified preview of one change. */
export function changeLines(change: FileChange): { type: "meta" | "add" | "del" | "ctx"; text: string }[] {
  if (change.kind === "write") {
    const body = (change.content ?? "").split("\n");
    return [
      { type: "meta", text: `+++ ${change.path} (new / rewrite)` },
      ...body.map((text) => ({ type: "add" as const, text: `+ ${text}` })),
    ];
  }
  const oldLines = (change.old ?? "").split("\n");
  const newLines = (change.next ?? "").split("\n");
  return [
    { type: "meta", text: `--- ${change.path}${change.replaceAll ? " (all)" : ""}` },
    ...oldLines.map((text) => ({ type: "del" as const, text: `- ${text}` })),
    ...newLines.map((text) => ({ type: "add" as const, text: `+ ${text}` })),
  ];
}
