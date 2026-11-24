export type ItemSection = "done" | "wip" | "risk" | "next" | "unclassified";
export type ReportTemplate = "ops" | "exec";

export type ReportItem = {
  id: string;
  section: ItemSection;
  text: string;
  evidence: string;
};

export type ExtractResult = {
  periodHint?: string;
  items: ReportItem[];
  gaps: string[];
};

export type ReportBatch = ExtractResult & {
  template: ReportTemplate;
};

const VALID_SECTIONS = new Set<ItemSection>([
  "done", "wip", "risk", "next", "unclassified",
]);

export function validateExtractResult(result: ExtractResult): string[] {
  const problems: string[] = [];
  for (const item of result.items) {
    if (!VALID_SECTIONS.has(item.section)) {
      problems.push(`item ${item.id}: invalid section "${item.section}"`);
    }
    if (!item.evidence || item.evidence.trim() === "") {
      problems.push(`item ${item.id}: evidence is required`);
    }
  }
  return problems;
}