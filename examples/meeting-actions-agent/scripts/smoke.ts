import { readFileSync } from "node:fs";
import path from "node:path";
import { extractActions } from "../lib/extract.ts";
import { composeDraft } from "../lib/compose.ts";
import { confirmActions } from "../lib/confirm.ts";
import { saveActions } from "../lib/save.ts";

const text = readFileSync(path.join(import.meta.dirname, "../data/fixtures/standup-zh.txt"), "utf8");
const extracted = extractActions(text);
const draft = composeDraft(extracted);
const patches = draft.pendingOwnerIds.map((id) => ({
  id,
  owner: "待定-smoke",
  priority: "P2" as const,
}));
const batch = confirmActions(extracted, patches);
const saved = saveActions(batch);
console.log("ok", saved.mdPath);