/**
 * 知识点：Trace 断言 —— 不看模型文案，只看「工具有没有按约定顺序出现」。
 * 用子序列匹配：期望列表必须按顺序出现在实际调用里，中间可以夹杂别的工具。
 */

export type TraceEntry = { tool: string; ok?: boolean };

/** 期望工具名是否按顺序出现在实际序列中（允许中间插入其他工具）。 */
export function matchesExpectedOrder(actual: string[], expected: string[]): boolean {
  if (expected.length === 0) return true;
  let i = 0;
  for (const tool of actual) {
    if (tool === expected[i]) i += 1;
    if (i === expected.length) return true;
  }
  return false;
}

/** earlier 是否出现在 later 之前（later 未出现也算「在之前」）。 */
export function appearsBefore(actual: string[], earlier: string, later: string): boolean {
  const a = actual.indexOf(earlier);
  if (a < 0) return false;
  const b = actual.indexOf(later);
  return b < 0 || a < b;
}

export function assertToolOrder(
  actual: string[] | TraceEntry[],
  expected: string[],
): { ok: boolean; reason?: string; actual: string[] } {
  const names = actual.map((item) => (typeof item === "string" ? item : item.tool));
  if (matchesExpectedOrder(names, expected)) return { ok: true, actual: names };
  return {
    ok: false,
    actual: names,
    reason: `期望顺序（子序列）${JSON.stringify(expected)}，实际 ${JSON.stringify(names)}`,
  };
}

/** 从 jsonl 文本抽出 tool 名序列。 */
export function toolsFromJsonl(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as { tool?: unknown };
      if (typeof row.tool === "string") names.push(row.tool);
    } catch {
      // 跳过坏行
    }
  }
  return names;
}
