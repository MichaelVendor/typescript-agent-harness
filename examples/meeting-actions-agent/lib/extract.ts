import type { ActionKind, ActionRow, ExtractResult } from "./schema.ts";

const NAME_PREFIX = /^([\u4e00-\u9fa5]{2,4})[：:]/;

function rowTextAfterSpeaker(line: string): string {
  const withoutSpeaker = line.replace(NAME_PREFIX, "").trim();
  return withoutSpeaker || line;
}

function classifyLine(line: string): { kind: ActionKind; owner: string | null; text: string } {
  const evidence = line.trim();
  const nameMatch = evidence.match(NAME_PREFIX);
  const speaker = nameMatch?.[1] ?? null;

  if (/决议|决定/.test(evidence)) {
    let text = rowTextAfterSpeaker(evidence);
    text = text.replace(/^决议[—\-–]+/, "").trim() || evidence;
    return { kind: "decision", owner: null, text };
  }

  if (/\d+\s*ms/.test(evidence)) {
    return { kind: "info", owner: null, text: rowTextAfterSpeaker(evidence) };
  }

  if (/[？?]/.test(evidence) && (/谁|何人|哪位/.test(evidence) || /无人认领/.test(evidence))) {
    const text = evidence.replace(/^（[^）]*）\s*/, "").trim();
    return { kind: "action", owner: null, text };
  }

  if (speaker && /我(?:来|改|做|跟)/.test(evidence)) {
    const text = rowTextAfterSpeaker(evidence);
    return { kind: "action", owner: speaker, text };
  }

  return { kind: "action", owner: null, text: rowTextAfterSpeaker(evidence) };
}

function isTitleLine(line: string): boolean {
  return !NAME_PREFIX.test(line) && !/决议|决定/.test(line) && !/[？?]/.test(line) && !/\d+\s*ms/.test(line);
}

export function extractActions(text: string): ExtractResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let meetingTitle: string | undefined;
  const bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && isTitleLine(line)) {
      meetingTitle = line;
      continue;
    }
    bodyLines.push(line);
  }

  const rows: ActionRow[] = [];
  const gaps: string[] = [];
  let counter = 0;

  for (const line of bodyLines) {
    const id = `a${++counter}`;
    const evidence = line.trim();
    const { kind, owner, text: rowText } = classifyLine(line);

    rows.push({
      id,
      kind,
      text: rowText,
      owner,
      due: null,
      priority: null,
      evidence,
    });

    if (kind === "action" && owner === null) {
      const hint = rowText.length > 24 ? `${rowText.slice(0, 24)}…` : rowText;
      gaps.push(`${id} 缺负责人（${hint}）`);
    }
  }

  return {
    ...(meetingTitle !== undefined ? { meetingTitle } : {}),
    rows,
    gaps,
  };
}