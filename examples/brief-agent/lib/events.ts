/** 自定义事件名集中在这里，tools 发、plugins 收，避免拼错的字符串两边对不上。 */
export const BRIEF_SAVED = "brief.saved" as const;

export type BriefSavedPayload = {
  jsonPath: string;
  mdPath: string;
};

/** 事件负载校验：插件侧拿到 unknown，这里收窄一次。 */
export function briefSaved(payload: unknown): BriefSavedPayload | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const p = payload as { jsonPath?: unknown; mdPath?: unknown };
  if (typeof p.jsonPath !== "string" || typeof p.mdPath !== "string") return undefined;
  return { jsonPath: p.jsonPath, mdPath: p.mdPath };
}
