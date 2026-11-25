import { validateDayBundle, type DayBundle } from "./schema.ts";

export type BundleParts = {
  date: string;
  git?: DayBundle["git"];
  cursor?: DayBundle["cursor"];
  browser?: DayBundle["browser"];
  gaps?: string[];
};

export function composeBundle(parts: BundleParts): DayBundle {
  const bundle: DayBundle = {
    date: parts.date,
    git: parts.git ?? [],
    cursor: parts.cursor ?? [],
    browser: parts.browser ?? [],
    gaps: [...new Set(parts.gaps ?? [])],
  };
  const problems = validateDayBundle(bundle);
  if (problems.length) throw new Error(`validation failed: ${problems.join("; ")}`);
  return bundle;
}
