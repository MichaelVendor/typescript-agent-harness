import { SKILL_NAME_RE, type SkillMeta } from "./types.js";

const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 1024;

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(v)) return true;
  if (["false", "no", "off", "0"].includes(v)) return false;
  return defaultValue;
}

function parseFrontmatterBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return out;
}

export function parseSkillMarkdown(
  raw: string,
  expectedName: string,
): { ok: true; meta: SkillMeta; body: string } | { ok: false; warning: string } {
  const trimmed = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  if (!trimmed.startsWith("---")) {
    return { ok: false, warning: "missing YAML frontmatter" };
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end === -1) {
    return { ok: false, warning: "unclosed YAML frontmatter" };
  }
  const fm = parseFrontmatterBlock(trimmed.slice(4, end));
  const body = trimmed.slice(end + 4).replace(/^\n/, "");

  const name = fm.name?.trim() ?? "";
  if (!name) {
    return { ok: false, warning: "missing required field: name" };
  }
  if (name !== expectedName) {
    return { ok: false, warning: `name "${name}" does not match expected "${expectedName}"` };
  }
  if (!SKILL_NAME_RE.test(name) || name.length > MAX_NAME_LEN) {
    return { ok: false, warning: `invalid skill name: ${name}` };
  }

  const description = fm.description?.trim() ?? "";
  if (description.length < 1 || description.length > MAX_DESC_LEN) {
    return { ok: false, warning: "description must be 1–1024 characters" };
  }

  const disableModel = parseBool(fm["disable-model-invocation"], false);
  const userInvocable = parseBool(fm["user-invocable"], true);

  return {
    ok: true,
    meta: {
      name,
      description,
      modelInvocable: !disableModel,
      userInvocable,
    },
    body,
  };
}
