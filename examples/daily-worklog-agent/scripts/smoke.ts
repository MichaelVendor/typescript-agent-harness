import { readFileSync } from "node:fs";
import path from "node:path";
import { summarizeFromBundle } from "../lib/summarize.ts";
import { saveDayCard } from "../lib/save.ts";
import type { DayBundle } from "../lib/schema.ts";

const bundle = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "../data/fixtures/bundle-sample.json"), "utf8"),
) as DayBundle;
const saved = saveDayCard(bundle, summarizeFromBundle(bundle));
console.log("ok", saved.mdPath);
