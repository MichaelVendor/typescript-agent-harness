import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDayBundle, type DayBundle, type DayCard } from "./schema.ts";
import { renderDayCard } from "./render.ts";

const DEFAULT_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

function assertValid(bundle: DayBundle): void {
  const problems = validateDayBundle(bundle);
  if (problems.length) throw new Error(`validation failed: ${problems.join("; ")}`);
}

/** Simple scan: URLs / 7+ hex hashes in summary must appear in the bundle. */
function summaryProblems(bundle: DayBundle, summary: string): string[] {
  const urls = new Set<string>([
    ...bundle.browser.map((b) => b.url),
    ...bundle.cursor.map((c) => c.evidence),
  ]);
  const hashes = bundle.git.flatMap((g) => g.commits.map((c) => c.hash.toLowerCase()));
  const problems: string[] = [];
  for (const m of summary.match(/https:\/\/[^\s)>\]"'`]+/g) ?? []) {
    if (![...urls].some((u) => u.startsWith(m) || m.startsWith(u))) problems.push(`summary url not in bundle: ${m}`);
  }
  // require at least one digit so plain words like "defaced" are not treated as hashes
  for (const m of summary.match(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi) ?? []) {
    const h = m.toLowerCase();
    if (!hashes.some((x) => x.startsWith(h) || h.startsWith(x))) problems.push(`summary hash not in bundle: ${m}`);
  }
  return problems;
}

function write(file: string, data: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export function saveBundle(bundle: DayBundle, opts: { outDir?: string } = {}): { jsonPath: string } {
  assertValid(bundle);
  const jsonPath = path.join(opts.outDir ?? DEFAULT_OUT, "bundles", `${bundle.date}.json`);
  write(jsonPath, JSON.stringify(bundle, null, 2) + "\n");
  return { jsonPath };
}

export function saveDayCard(
  bundle: DayBundle,
  summary: string,
  opts: { outDir?: string } = {},
): { mdPath: string; jsonPath: string; markdown: string } {
  assertValid(bundle);
  const problems = summaryProblems(bundle, summary);
  if (problems.length) throw new Error(`validation failed: ${problems.join("; ")}`);
  const { markdown } = renderDayCard(bundle, summary);
  const dir = path.join(opts.outDir ?? DEFAULT_OUT, "daily");
  const mdPath = path.join(dir, `${bundle.date}.md`);
  const jsonPath = path.join(dir, `${bundle.date}.json`);
  const card: DayCard = { date: bundle.date, summary, markdown, bundle };
  write(mdPath, markdown);
  write(jsonPath, JSON.stringify(card, null, 2) + "\n");
  return { mdPath, jsonPath, markdown };
}
