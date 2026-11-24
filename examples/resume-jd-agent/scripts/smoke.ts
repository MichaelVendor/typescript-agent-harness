import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePair } from "../lib/parse.ts";
import { matchRequirements } from "../lib/match.ts";
import { composeRewrites } from "../lib/rewrite.ts";
import { saveReport, selectIncludeRewrites } from "../lib/save.ts";

const text = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/pair-zh.txt"),
  "utf8",
);
const match = matchRequirements(parsePair(text));
const { rewrites } = composeRewrites(match);
const batch = selectIncludeRewrites(match, true, rewrites);
const saved = saveReport(batch);
console.log("ok", saved.mdPath);
