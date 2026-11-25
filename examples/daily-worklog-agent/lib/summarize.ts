import type { DayBundle } from "./schema.ts";

/** smoke: deterministic summary built only from bundle contents; no LLM. */
export function summarizeFromBundle(bundle: DayBundle): string {
  const lines: string[] = [];
  for (const g of bundle.git) {
    for (const c of g.commits) lines.push(`- git ${c.hash.slice(0, 7)} ${c.subject} (${g.repo})`);
  }
  for (const c of bundle.cursor) lines.push(`- cursor ${c.workspace}: ${c.note} [${c.evidence}]`);
  for (const b of bundle.browser) lines.push(`- browser ${b.title || b.url} ${b.url}`);
  const head = lines.length ? lines.join("\n") : "无活动记录 (no activity)";
  const gaps = bundle.gaps.length ? `\n缺口: ${bundle.gaps.join("; ")}` : "";
  return `${head}${gaps}`;
}
