import type { JdRequirement, ParseResult, Priority } from "./schema.ts";

const RESUME_MARK = "===简历===";
const JD_MARK = "===JD===";
const PRIORITY_TAGS: Array<[string, Priority]> = [
  ["【必须】", "must"],
  ["【加分】", "nice"],
];

function section(text: string, mark: string, nextMark: string): string {
  const start = text.indexOf(mark);
  if (start < 0) return "";
  const from = start + mark.length;
  const end = text.indexOf(nextMark, from);
  return text.slice(from, end < 0 ? undefined : end);
}

export function parsePair(text: string): ParseResult {
  const resumeBullets = section(text, RESUME_MARK, JD_MARK)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);

  const jdRequirements: JdRequirement[] = [];
  for (const raw of section(text, JD_MARK, RESUME_MARK).split(/\r?\n/)) {
    const line = raw.trim();
    const tag = PRIORITY_TAGS.find(([t]) => line.startsWith(t));
    if (!tag) continue;
    const body = line.slice(tag[0].length).trim();
    if (!body) continue;
    jdRequirements.push({ id: `r${jdRequirements.length + 1}`, text: body, priority: tag[1] });
  }

  return { resumeBullets, jdRequirements };
}
