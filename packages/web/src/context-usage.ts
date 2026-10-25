/** Rough context window for a model name; used only for the rail percentage. */
export function contextWindow(model: string | undefined): number {
  const m = (model ?? "").toLowerCase();
  if (m.includes("gpt-4.1") || m.includes("gpt-4o") || m.includes("o3") || m.includes("o4")) return 128_000;
  if (m.includes("gpt-3.5")) return 16_000;
  if (m.includes("claude") && m.includes("opus")) return 200_000;
  if (m.includes("claude")) return 200_000;
  if (m.includes("deepseek")) return 128_000;
  if (m.includes("qwen") && m.includes("plus")) return 128_000;
  if (m.includes("qwen")) return 32_000;
  if (m.includes("gemini") && m.includes("pro")) return 1_000_000;
  if (m.includes("gemini")) return 128_000;
  return 128_000;
}

/** How much of the estimated window the session tokens have used (0–100). */
export function contextPercent(
  tokens: { promptTokens: number; completionTokens: number } | undefined,
  model: string | undefined,
): number | undefined {
  if (!tokens) return undefined;
  const used = tokens.promptTokens + tokens.completionTokens;
  if (used <= 0) return undefined;
  const window = contextWindow(model);
  return Math.min(100, Math.round((used / window) * 100));
}
