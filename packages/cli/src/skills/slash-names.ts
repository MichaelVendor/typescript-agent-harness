const SLASH_RE = /(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

export function extractSlashSkills(text: string): { names: string[]; displayText: string } {
  const names = [...text.matchAll(new RegExp(SLASH_RE.source, "g"))].map((m) => m[1]!);
  return { names, displayText: text };
}
