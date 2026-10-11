import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSkillsCatalogSection } from "../dist/skills/catalog.js";
import { createSkillTool } from "../dist/skills/tool.js";
import { applySlashSkills } from "../dist/skills/slash.js";
import { buildSystemPrompt } from "../dist/prompt.js";
import type { SkillSummary } from "../dist/skills/types.js";

const base = (over: Partial<SkillSummary> & Pick<SkillSummary, "name">): SkillSummary => ({
  description: `Desc for ${over.name}`,
  modelInvocable: true,
  userInvocable: true,
  dir: `/tmp/${over.name}`,
  skillFile: `/tmp/${over.name}/SKILL.md`,
  source: "skills",
  ...over,
});

test("catalog omits disable-model skills and truncates description", () => {
  const section = buildSkillsCatalogSection([
    base({ name: "a", description: "x".repeat(600) }),
    base({ name: "b", modelInvocable: false, description: "hidden" }),
  ]);
  assert.ok(section);
  assert.match(section!, /- a: /);
  assert.doesNotMatch(section!, /- b:|hidden/);
  assert.ok(section!.includes("x".repeat(500)));
  assert.ok(!section!.includes("x".repeat(501)));
});

test("buildSystemPrompt appends skills section", () => {
  const skills = buildSkillsCatalogSection([base({ name: "demo", description: "Demo skill." })]);
  const prompt = buildSystemPrompt({ exec: true, mcp: false, skillsCatalog: skills });
  assert.match(prompt, /Available skills/i);
  assert.match(prompt, /demo/);
});

test("skill tool returns error string for non-model-invocable", async () => {
  const tool = createSkillTool([base({ name: "manual", modelInvocable: false })]);
  const ctx = {
    sessionId: "s",
    callId: "c",
    signal: AbortSignal.timeout(1000),
    runtime: { get() {}, tryGet() {}, emit() {} },
  };
  const out = await tool.execute({ name: "manual" }, ctx as never);
  assert.match(String(out), /not model-invocable|unknown skill/i);
});

test("skill tool returns rendered body for a model-invocable skill", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-skill-"));
  mkdirSync(path.join(cwd, "greet"), { recursive: true });
  writeFileSync(path.join(cwd, "greet", "note.md"), "note");
  writeFileSync(
    path.join(cwd, "greet", "SKILL.md"),
    "---\nname: greet\ndescription: Greet.\n---\nSay hi. See note.md\n",
  );
  const tool = createSkillTool([
    base({
      name: "greet",
      dir: path.join(cwd, "greet"),
      skillFile: path.join(cwd, "greet", "SKILL.md"),
    }),
  ]);
  const ctx = {
    sessionId: "s",
    callId: "c",
    signal: AbortSignal.timeout(1000),
    runtime: { get() {}, tryGet() {}, emit() {} },
  };
  const out = String(await tool.execute({ name: "greet" }, ctx as never));
  assert.match(out, /<skill_content name="greet">/);
  assert.match(out, /Say hi\./);
  assert.match(out, /note\.md/);
  const missing = String(await tool.execute({ name: "missing" }, ctx as never));
  assert.match(missing, /^Error: unknown skill/i);
});

test("slash keeps display text; modelSuffix has user-invocable only", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-slash-"));
  mkdirSync(path.join(cwd, "greet"), { recursive: true });
  writeFileSync(
    path.join(cwd, "greet", "SKILL.md"),
    "---\nname: greet\ndescription: Greet.\n---\nSay hi.\n",
  );
  const summary = base({
    name: "greet",
    dir: path.join(cwd, "greet"),
    skillFile: path.join(cwd, "greet", "SKILL.md"),
  });
  const input = "hi /greet /nope";
  const { displayText, modelSuffix } = applySlashSkills(input, [summary]);
  assert.equal(displayText, input);
  assert.match(modelSuffix, /<skill_content name="greet">/);
  assert.doesNotMatch(modelSuffix, /nope/);
});

test("slash renders each user-invocable name once, in order", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-slash-"));
  for (const name of ["alpha", "beta"]) {
    mkdirSync(path.join(cwd, name), { recursive: true });
    writeFileSync(
      path.join(cwd, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}.\n---\nBody ${name}.\n`,
    );
  }
  const skills = ["alpha", "beta"].map((name) =>
    base({
      name,
      dir: path.join(cwd, name),
      skillFile: path.join(cwd, name, "SKILL.md"),
    }),
  );
  const hidden = base({
    ...skills[0]!,
    name: "alpha",
    userInvocable: false,
  });
  const skipped = applySlashSkills("/alpha", [hidden]);
  assert.equal(skipped.displayText, "/alpha");
  assert.equal(skipped.modelSuffix, "");

  const input = "/beta /alpha /beta";
  const { displayText, modelSuffix } = applySlashSkills(input, skills);
  assert.equal(displayText, input);
  const betaAt = modelSuffix.indexOf('name="beta"');
  const alphaAt = modelSuffix.indexOf('name="alpha"');
  assert.ok(betaAt >= 0 && alphaAt > betaAt);
  assert.equal(modelSuffix.match(/<skill_content /g)?.length, 2);
});
