import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Brief, BriefRow } from "./schema.ts";

function formatPrice(priceEur: number | null): string {
  if (priceEur === null) return "缺数据";
  return `€${priceEur.toFixed(2)}`;
}

function idSet(rows: BriefRow[]): Set<string> {
  return new Set(rows.map((r) => r.id));
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function setDiff(prev: string[], curr: string[]): { added: string[]; removed: string[] } {
  const p = new Set(prev);
  const c = new Set(curr);
  return {
    added: curr.filter((x) => !p.has(x)),
    removed: prev.filter((x) => !c.has(x)),
  };
}

/** 按文件名倒序扫 *.json，找 rows.id 集合与当前完全相等的最近一份。 */
export function findPreviousBrief(dir: string, currentIds: string[]): Brief | null {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort().reverse();
  } catch {
    return null;
  }
  const want = new Set(currentIds);
  for (const name of names) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Brief;
      if (!Array.isArray(raw.rows)) continue;
      if (sameIdSet(idSet(raw.rows), want)) return raw;
    } catch {
      // skip bad files
    }
  }
  return null;
}

/** 对比两份 brief 的 rows，返回「### 变更」下的条目（不含标题）。 */
export function diffBriefRows(previous: Brief | null, current: BriefRow[]): string[] {
  if (!previous) return ["无上次简报可对比"];

  const lines: string[] = [];
  const prevMap = new Map(previous.rows.map((r) => [r.id, r]));
  const currMap = new Map(current.map((r) => [r.id, r]));

  for (const row of current) {
    if (!prevMap.has(row.id)) {
      lines.push(`新增 ${row.id} ${row.title}`);
    }
  }
  for (const row of previous.rows) {
    if (!currMap.has(row.id)) {
      lines.push(`消失 ${row.id} ${row.title}`);
    }
  }

  for (const row of current) {
    const prev = prevMap.get(row.id);
    if (!prev) continue;

    if (prev.priceEur !== row.priceEur) {
      lines.push(`${row.id} 价格 ${formatPrice(prev.priceEur)} → ${formatPrice(row.priceEur)}`);
    }

    const bullets = setDiff(prev.bullets, row.bullets);
    for (const b of bullets.added) lines.push(`${row.id} 卖点 +「${b}」`);
    for (const b of bullets.removed) lines.push(`${row.id} 卖点 -「${b}」`);

    const themes = setDiff(prev.reviewThemes, row.reviewThemes);
    for (const t of themes.added) lines.push(`${row.id} 差评主题 +「${t}」`);
    for (const t of themes.removed) lines.push(`${row.id} 差评主题 -「${t}」`);
  }

  if (lines.length === 0) return ["相对上次无字段变化"];
  return lines;
}

export function renderChangesSection(lines: string[]): string {
  const body = lines.map((l) => `- ${l}`).join("\n");
  return `### 变更\n${body}\n`;
}
