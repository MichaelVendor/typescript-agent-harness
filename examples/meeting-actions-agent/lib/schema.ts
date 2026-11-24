export type ActionKind = "decision" | "action" | "info";

export type ActionRow = {
  id: string;
  kind: ActionKind;
  text: string;
  owner: string | null;
  due: string | null;
  priority: "P0" | "P1" | "P2" | null;
  evidence: string;
};

export type ExtractResult = {
  meetingTitle?: string;
  rows: ActionRow[];
  gaps: string[];
};

const VALID_KINDS = new Set<ActionKind>(["decision", "action", "info"]);
const VALID_PRIORITIES = new Set(["P0", "P1", "P2"]);

export function validateExtractResult(result: ExtractResult): string[] {
  const problems: string[] = [];

  for (const row of result.rows) {
    if (!VALID_KINDS.has(row.kind)) {
      problems.push(`row ${row.id}: invalid kind "${row.kind}"`);
    }
    if (!row.evidence || row.evidence.trim() === "") {
      problems.push(`row ${row.id}: evidence is required`);
    }
    if (row.priority !== null && !VALID_PRIORITIES.has(row.priority)) {
      problems.push(`row ${row.id}: invalid priority "${row.priority}"`);
    }
  }

  return problems;
}