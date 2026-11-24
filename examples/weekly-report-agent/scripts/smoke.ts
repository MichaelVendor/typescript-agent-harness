import { readFileSync } from "node:fs";
import path from "node:path";
import { extractItems } from "../lib/extract.ts";
import { composeDraft } from "../lib/compose.ts";
import { selectTemplate, saveReport } from "../lib/save.ts";

const text = readFileSync(
  path.join(import.meta.dirname, "../data/fixtures/notes-zh.txt"),
  "utf8",
);
const extracted = extractItems(text);
composeDraft(extracted); // 预览侧效应：无
const batch = selectTemplate(extracted, "ops");
const saved = saveReport(batch);
console.log("ok", saved.mdPath);
