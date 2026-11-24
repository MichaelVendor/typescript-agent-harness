import type { ActionRow, ExtractResult } from "./schema.ts";

export type ActionBatch = ExtractResult & { confirmed: boolean };

type Patch = {
  id: string;
  owner?: string | null;
  priority?: ActionRow["priority"];
};

export function confirmActions(
  result: ExtractResult | ActionBatch,
  patches: Patch[],
): ActionBatch {
  const patchById = new Map(patches.map((p) => [p.id, p]));
  const rows = result.rows.map((row) => {
    const patch = patchById.get(row.id);
    if (!patch) return { ...row };
    return {
      ...row,
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    };
  });

  return {
    ...(result.meetingTitle !== undefined ? { meetingTitle: result.meetingTitle } : {}),
    rows,
    gaps: [...result.gaps],
    confirmed: true,
  };
}