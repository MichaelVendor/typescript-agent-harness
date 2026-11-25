import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDayBundle, type DayBundle, type DayCard } from "./schema.ts";
import { renderDayCard } from "./render.ts";

const DEFAULT_OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

function assertValid(bundle: DayBundle): void {
  const problems = validateDayBundle(bundle);
  if (problems.length) throw new Error(`validation failed: ${problems.join("; ")}`);
}

const HEX_RE = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi;
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;

/** A summary URL is allowed iff a bundle URL equals it or extends it at a /, ?, # boundary. */
function urlAllowed(m: string, urls: string[]): boolean {
  return urls.some((u) => u === m || (u.startsWith(m) && "/?#".includes(u[m.length]!)));
}

/** Simple scan: URLs / 7+ hex tokens in summary must appear in the bundle. */
function summaryProblems(bundle: DayBundle, summary: string): string[] {
  const urls = [...bundle.browser.map((b) => b.url), ...bundle.cursor.map((c) => c.evidence)];
  const gitHashes = bundle.git.flatMap((g) => g.commits.map((c) => c.hash.toLowerCase()));
  // Cursor evidence paths embed UUID fragments (e.g. <uuid>/<uuid>.jsonl); those tokens are already in the bundle.
  const cursorTokens = bundle.cursor.flatMap((c) =>
    [c.evidence, c.note].flatMap((t) => (t.match(HEX_RE) ?? []).map((h) => h.toLowerCase())),
  );
  const problems: string[] = [];
  for (const raw of summary.match(URL_RE) ?? []) {
    const m = raw.replace(/[.,;:!?]+$/, "");
    if (!urlAllowed(m, urls)) problems.push(`summary url not in bundle: ${m}`);
  }
  // require at least one digit so plain words like "defaced" are not treated as hashes
  for (const m of summary.match(HEX_RE) ?? []) {
    const h = m.toLowerCase();
    const ok =
      gitHashes.some((x) => x.startsWith(h) || h.startsWith(x)) || cursorTokens.some((x) => x.startsWith(h));
    if (!ok) problems.push(`summary hash not in bundle: ${m}`);
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

/** Load a previously saved out/bundles/<date>.json, or null if absent (or date is not YYYY-MM-DD). */
export function loadBundle(date: string, opts: { outDir?: string } = {}): DayBundle | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const file = path.join(opts.outDir ?? DEFAULT_OUT, "bundles", `${date}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DayBundle) : null;
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
