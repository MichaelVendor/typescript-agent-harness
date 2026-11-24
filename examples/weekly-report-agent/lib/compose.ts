import type { ExtractResult, ItemSection } from "./schema.ts";

const SECTIONS: { key: ItemSection; title: string }[] = [
  { key: "done", title: "已完成" },
  { key: "wip", title: "进行中" },
  { key: "risk", title: "风险" },
  { key: "next", title: "下周计划" },
  { key: "unclassified", title: "未归类" },
];

export function composeDraft(
  result: ExtractResult,
): { markdown: string; unclassifiedIds: string[] } {
  const unclassifiedIds = result.items
    .filter((i) => i.section === "unclassified")
    .map((i) => i.id);

  const lines: string[] = [
    "# 周报草稿",
    "",
    `周期：${result.periodHint ?? "待确认"}`,
    "",
  ];

  for (const { key, title } of SECTIONS) {
    lines.push(`## ${title}`, "");
    const rows = result.items.filter((i) => i.section === key);
    if (rows.length === 0) {
      lines.push("（无）");
    } else {
      for (const row of rows) lines.push(`- **${row.id}**：${row.text}`);
    }
    lines.push("");
  }

  lines.push("## 缺口", "");
  if (result.gaps.length === 0) {
    lines.push("（无）");
  } else {
    for (const gap of result.gaps) lines.push(`- ${gap}`);
  }

  lines.push(
    "",
    "## 下一步",
    "",
    "待选模板：请用 `ask_user` 选择 `ops` 或 `exec`。",
  );

  return { markdown: lines.join("\n"), unclassifiedIds };
}
