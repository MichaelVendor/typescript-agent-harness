/**
 * Brief eval 断言：锁 gaps / 行级禁 € / evidence / failures / row ids。
 * 不看模型文案，只看 schema 与 markdown 行作用域。
 */
import { existsSync } from "node:fs";
import type { Brief, Problem } from "../lib/schema.ts";

export type AssertResult = { ok: boolean; reason?: string };

const EURO_PRICE = /€\s*\d|\d+[.,]\d{2}\s*€/;

/** Lines that mention `needle` — priced peers must not false-flag null-price rows. */
export function markdownScope(markdown: string, needle: string): string {
  return markdown
    .split("\n")
    .filter((line) => line.includes(needle))
    .join("\n");
}

export function assertMinEvidence(brief: Brief, min: number): AssertResult {
  for (const row of brief.rows) {
    if (row.evidence.length < min) {
      return {
        ok: false,
        reason: `rows.${row.id}.evidence=${row.evidence.length} < ${min}`,
      };
    }
  }
  return { ok: true };
}

export function assertGapSubstring(brief: Brief, needle: string): AssertResult {
  if (brief.gaps.some((g) => g.includes(needle))) return { ok: true };
  return {
    ok: false,
    reason: `gaps 缺少「${needle}」: ${JSON.stringify(brief.gaps)}`,
  };
}

/** No € digit price on lines that mention any of the given title needles. */
export function assertNoEuroOnTitles(markdown: string, titles: string[]): AssertResult {
  for (const title of titles) {
    const scope = markdownScope(markdown, title);
    if (EURO_PRICE.test(scope)) {
      return { ok: false, reason: `标题「${title}」相关行出现 € 价` };
    }
  }
  return { ok: true };
}

export function assertFailureId(brief: Brief, id: string): AssertResult {
  if (brief.failures.some((f) => f.id === id)) return { ok: true };
  return {
    ok: false,
    reason: `failures 缺少 id=${id}；实际=${JSON.stringify(brief.failures.map((f) => f.id))}`,
  };
}

export function assertRowIds(brief: Brief, ids: string[]): AssertResult {
  const actual = brief.rows.map((r) => r.id);
  const same =
    actual.length === ids.length && ids.every((id) => actual.includes(id));
  if (same) return { ok: true };
  return {
    ok: false,
    reason: `期望 row ids ${JSON.stringify(ids)}，实际 ${JSON.stringify(actual)}`,
  };
}

export function assertSavedFiles(paths: { jsonPath: string; mdPath: string }): AssertResult {
  if (!existsSync(paths.jsonPath)) {
    return { ok: false, reason: `缺 json: ${paths.jsonPath}` };
  }
  if (!existsSync(paths.mdPath)) {
    return { ok: false, reason: `缺 md: ${paths.mdPath}` };
  }
  return { ok: true };
}

export function assertValidateOutcome(
  problems: Problem[],
  expectFail: boolean,
): AssertResult {
  const failed = problems.length > 0;
  if (failed === expectFail) return { ok: true };
  return {
    ok: false,
    reason: expectFail
      ? "期望 validateBrief 失败，实际通过"
      : `期望 validateBrief 通过，实际 ${JSON.stringify(problems)}`,
  };
}

export function firstFailure(...results: AssertResult[]): AssertResult {
  for (const r of results) {
    if (!r.ok) return r;
  }
  return { ok: true };
}
