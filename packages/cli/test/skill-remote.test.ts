import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addRemoteSkills, findSkillDirs, parseSkillSource } from "../dist/skills/remote.js";

const skill = (dir: string, name: string, body = "Use when testing.") => {
  const root = path.join(dir, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`);
  return root;
};

test("parseSkillSource: local paths stay local", () => {
  assert.deepEqual(parseSkillSource("./skills"), { kind: "local", root: path.resolve("./skills"), subpath: "" });
  assert.deepEqual(parseSkillSource("/tmp/x"), { kind: "local", root: "/tmp/x", subpath: "" });
});

test("parseSkillSource: owner/repo and nested path + ref", () => {
  assert.deepEqual(parseSkillSource("anthropics/skills"), {
    kind: "git",
    url: "https://github.com/anthropics/skills.git",
    subpath: "",
  });
  assert.deepEqual(parseSkillSource("anthropics/skills/skills/pdf#v1.0.0"), {
    kind: "git",
    url: "https://github.com/anthropics/skills.git",
    subpath: "skills/pdf",
    ref: "v1.0.0",
  });
});

test("parseSkillSource: full git URL keeps host and #ref", () => {
  assert.deepEqual(parseSkillSource("https://gitlab.com/org/repo.git#main"), {
    kind: "git",
    url: "https://gitlab.com/org/repo.git",
    subpath: "",
    ref: "main",
  });
  assert.deepEqual(parseSkillSource("git@github.com:acme/skills.git"), {
    kind: "git",
    url: "git@github.com:acme/skills.git",
    subpath: "",
  });
});

test("findSkillDirs: one skill, a folder of skills, or skills/ under a repo root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-skill-"));
  const one = skill(root, "hello");
  assert.deepEqual(findSkillDirs(one), [one]);

  const pack = mkdtempSync(path.join(tmpdir(), "tah-skills-"));
  const a = skill(pack, "alpha");
  const b = skill(pack, "beta");
  assert.deepEqual(findSkillDirs(pack).sort(), [a, b].sort());

  const repo = mkdtempSync(path.join(tmpdir(), "tah-repo-"));
  mkdirSync(path.join(repo, "skills"), { recursive: true });
  const pdf = skill(path.join(repo, "skills"), "pdf");
  assert.deepEqual(findSkillDirs(repo), [pdf]);
});

test("findSkillDirs: marketplace.json skill paths when not under skills/", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "tah-mkt-"));
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(path.join(repo, "plugins", "xlsx"), { recursive: true });
  writeFileSync(
    path.join(repo, "plugins", "xlsx", "SKILL.md"),
    "---\nname: xlsx\ndescription: Excel\n---\n\n# xlsx\n",
  );
  writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "demo",
      plugins: [{ name: "docs", skills: ["./plugins/xlsx"] }],
    }),
  );
  assert.deepEqual(findSkillDirs(repo), [path.join(repo, "plugins", "xlsx")]);
});

test("addRemoteSkills clones then copies into ~/.tah/skills", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  const result = addRemoteSkills({
    homeDir: home,
    cwd: home,
    source: "acme/skills",
    clone: (_url, dest) => {
      mkdirSync(path.join(dest, "skills"), { recursive: true });
      skill(path.join(dest, "skills"), "pdf");
    },
  });
  assert.deepEqual(result.imported, ["pdf"]);
  assert.ok(existsSync(path.join(home, ".tah", "skills", "pdf", "SKILL.md")));
});

test("addRemoteSkills --project writes into cwd/skills", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-home-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cwd-"));
  const pack = mkdtempSync(path.join(tmpdir(), "tah-pack-"));
  skill(pack, "hello");
  const result = addRemoteSkills({
    homeDir: home,
    cwd,
    source: pack,
    project: true,
  });
  assert.deepEqual(result.imported, ["hello"]);
  assert.ok(existsSync(path.join(cwd, "skills", "hello", "SKILL.md")));
  assert.equal(existsSync(path.join(home, ".tah", "skills", "hello")), false);
});
