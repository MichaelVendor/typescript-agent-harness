const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlashPrompt = {
  name: string;
  server: string;
  required: boolean;
  copies: number;
  load(): Promise<string>;
};

type SlashScan = {
  extractSlashSkills(text: string): { names: string[]; displayText: string };
};

let scanPromise: Promise<SlashScan> | undefined;

/** `extractSlashSkills` lives next to skill loaders. Tests load this file from source, where those `.js` specifiers do not exist. */
function loadScan(): Promise<SlashScan> {
  if (!scanPromise) {
    scanPromise = import.meta.url.endsWith(".ts")
      ? import(new URL("./skills/slash-names.ts", import.meta.url).href)
      : import("./skills/slash-names.js");
  }
  return scanPromise;
}

/** Suffix only. Empty means nothing to append. Skill names, required args, and duplicates stay unexpanded. */
export async function applySlashPrompts(
  text: string,
  prompts: SlashPrompt[],
  skillNames: ReadonlySet<string>,
): Promise<string> {
  const { extractSlashSkills } = await loadScan();
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const name of extractSlashSkills(text).names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!SKILL_NAME_RE.test(name) || skillNames.has(name)) continue;
    const matches = prompts.filter((item) => item.name === name);
    if (matches.length !== 1) continue;
    const item = matches[0]!;
    if (item.copies !== 1 || item.required) continue;
    let body: string;
    try {
      body = await item.load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      body = `Error: ${message}`;
    }
    parts.push(`<mcp_prompt name="${name}">\n${body}\n</mcp_prompt>`);
  }
  return parts.join("\n\n");
}
