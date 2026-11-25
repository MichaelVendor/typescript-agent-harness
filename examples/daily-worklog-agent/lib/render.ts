import type { DayBundle } from "./schema.ts";

export function renderDayCard(bundle: DayBundle, summary: string): { markdown: string } {
  const out: string[] = [`# ${bundle.date}`, "", "## Summary", "", summary.trim(), ""];

  out.push("## Git", "");
  const commits = bundle.git.flatMap((g) => g.commits.map((c) => `- \`${c.hash.slice(0, 7)}\` ${c.subject} — ${g.repo}`));
  out.push(...(commits.length ? commits : ["_none_"]), "");

  out.push("## Cursor", "");
  const cur = bundle.cursor.map((c) => `- ${c.workspace}: ${c.note} (evidence: ${c.evidence})`);
  out.push(...(cur.length ? cur : ["_none_"]), "");

  out.push("## Browser", "");
  const br = bundle.browser.map((b) => `- [${b.title || b.url}](${b.url})${b.visitTime ? ` ${b.visitTime}` : ""}`);
  out.push(...(br.length ? br : ["_none_"]), "");

  out.push("## Gaps", "");
  out.push(...(bundle.gaps.length ? bundle.gaps.map((g) => `- ${g}`) : ["_none_"]), "");

  return { markdown: out.join("\n") };
}
