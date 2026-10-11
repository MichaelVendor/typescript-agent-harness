import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverSkills } from "../dist/skills/discover.js";

function writeSkill(root: string, name: string, body: string, extra = "") {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Does ${name}. Use when testing.\n${extra}---\n# ${name}\n${body}\n`,
  );
}

test("priority: skills/ > .agents > .cursor > home", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sk-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  writeSkill(path.join(home, ".tah/skills"), "demo", "home");
  writeSkill(path.join(cwd, ".cursor/skills"), "demo", "cursor");
  writeSkill(path.join(cwd, ".agents/skills"), "demo", "agents");
  writeSkill(path.join(cwd, "skills"), "demo", "project");
  const { skills, warnings } = discoverSkills({ cwd, isProject: true, homeDir: home });
  assert.equal(warnings.length, 0);
  assert.equal(skills.length, 1);
  assert.equal(skills[0]!.source, "skills");
  assert.match(skills[0]!.dir, /skills[/\\]demo$/);
});

test("non-project skips project roots but keeps home", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sk-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  writeSkill(path.join(cwd, "skills"), "demo", "project");
  writeSkill(path.join(home, ".tah/skills"), "home-only", "home");
  const { skills } = discoverSkills({ cwd, isProject: false, homeDir: home });
  assert.deepEqual(skills.map((s) => s.name), ["home-only"]);
});

test("bad frontmatter is skipped with warning", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sk-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  mkdirSync(path.join(cwd, "skills", "bad"), { recursive: true });
  writeFileSync(path.join(cwd, "skills", "bad", "SKILL.md"), "no frontmatter\n");
  const { skills, warnings } = discoverSkills({ cwd, isProject: true, homeDir: home });
  assert.equal(skills.length, 0);
  assert.ok(warnings.some((w) => w.includes("skills/bad")));
});

test("disable-model-invocation and user-invocable flags", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sk-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  writeSkill(path.join(cwd, "skills"), "manual", "body", "disable-model-invocation: true\n");
  const { skills } = discoverSkills({ cwd, isProject: true, homeDir: home });
  assert.equal(skills[0]!.modelInvocable, false);
  assert.equal(skills[0]!.userInvocable, true);
});

test("flat name.md under skills root", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sk-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  mkdirSync(path.join(cwd, "skills"), { recursive: true });
  writeFileSync(
    path.join(cwd, "skills", "flat-one.md"),
    "---\nname: flat-one\ndescription: Flat skill for tests.\n---\nBody\n",
  );
  const { skills } = discoverSkills({ cwd, isProject: true, homeDir: home });
  assert.equal(skills[0]!.name, "flat-one");
  assert.equal(path.basename(skills[0]!.skillFile), "flat-one.md");
});
