/** 自定义事件名集中在这里，tools 发、plugins 收，避免拼错的字符串两边对不上。 */
export const REPORT_SAVED = "report.saved" as const;

export type ReportSavedPayload = { file: string; candidates: number };

/** 事件负载校验：插件侧拿到 unknown，这里收窄一次。 */
export function reportSaved(payload: unknown): ReportSavedPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as { file?: unknown; candidates?: unknown };
  if (typeof p.file !== "string") return undefined;
  return { file: p.file, candidates: typeof p.candidates === "number" ? p.candidates : 0 };
}
