export type SkillSource = "skills" | "agents" | "cursor" | "home";

export type SkillName = string;

/** Kebab-case skill id: `^[a-z0-9]+(?:-[a-z0-9]+)*$` */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillSummary = {
  name: string;
  description: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  /** Absolute directory used as resourceBase (parent of flat .md). */
  dir: string;
  /** Absolute path to SKILL.md or flat .md */
  skillFile: string;
  source: SkillSource;
};

export type SkillMeta = {
  name: string;
  description: string;
  modelInvocable: boolean;
  userInvocable: boolean;
};
