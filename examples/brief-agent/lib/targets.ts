import { MAX_TARGETS } from "./schema.ts";

export type TargetRef = {
  id: string;
  url?: string;
  asin?: string;
  title?: string;
  query?: string;
};

export function resolveTargets(input: {
  market?: string;
  targets?: Array<Partial<TargetRef> & { text?: string }>;
  query?: string;
}): { market: "DE"; targets: TargetRef[]; truncated: boolean } {
  const market = "DE";
  let list = (input.targets ?? []).map((t, i) => {
    const asin = typeof t.asin === "string" ? t.asin : undefined;
    const id = (typeof t.id === "string" && t.id) || asin || `t${i + 1}`;
    return {
      id,
      url: typeof t.url === "string" ? t.url : undefined,
      asin,
      title: typeof t.title === "string" ? t.title : typeof t.text === "string" ? t.text : undefined,
      query: typeof t.query === "string" ? t.query : undefined,
    } satisfies TargetRef;
  });
  if (list.length === 0 && typeof input.query === "string" && input.query.trim()) {
    list = [{ id: "q1", query: input.query.trim(), title: input.query.trim() }];
  }
  const truncated = list.length > MAX_TARGETS;
  return { market, targets: list.slice(0, MAX_TARGETS), truncated };
}