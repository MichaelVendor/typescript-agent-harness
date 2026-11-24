import type { ExtractResult } from "./schema.ts";

export function composeDraft(
  result: ExtractResult,
): { markdown: string; pendingOwnerIds: string[] } {
  const title = result.meetingTitle ?? "会议行动项";
  const pendingOwnerIds = result.rows
    .filter((r) => r.kind === "action" && r.owner === null)
    .map((r) => r.id);

  const lines: string[] = [
    `# ${title}`,
    "",
    "## 行动项表",
    "",
    "| id | kind | text | owner | due | priority |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of result.rows) {
    const ownerCell = row.owner ?? "待确认";
    const dueCell = row.due ?? "—";
    const priorityCell = row.priority ?? "—";
    lines.push(
      `| ${row.id} | ${row.kind} | ${row.text} | ${ownerCell} | ${dueCell} | ${priorityCell} |`,
    );
  }

  lines.push("", "## 待确认", "");
  if (pendingOwnerIds.length === 0) {
    lines.push("（无）");
  } else {
    for (const id of pendingOwnerIds) {
      const row = result.rows.find((r) => r.id === id);
      lines.push(`- **${id}**：${row?.text ?? ""} — 负责人待确认`);
    }
  }

  lines.push("", "## 缺口", "");
  if (result.gaps.length === 0) {
    lines.push("（无）");
  } else {
    for (const gap of result.gaps) {
      lines.push(`- ${gap}`);
    }
  }

  return { markdown: lines.join("\n"), pendingOwnerIds };
}