import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listSkillResources } from "../dist/skills/resources.js";
import { renderSkillContent } from "../dist/skills/render.js";

test("lists relative refs inside skill root", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-res-"));
  mkdirSync(path.join(dir, "scripts"));
  writeFileSync(path.join(dir, "scripts", "run.sh"), "echo hi");
  writeFileSync(path.join(dir, "reference.md"), "x");
  const body = "See scripts/run.sh and ./reference.md please.";
  const refs = listSkillResources(dir, body);
  assert.deepEqual(
    refs.map((r) => r.path).sort(),
    ["reference.md", "scripts/run.sh"],
  );
});

test("rejects path escape", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-res-"));
  writeFileSync(path.join(dir, "ok.md"), "x");
  const refs = listSkillResources(dir, "See ../secret.md and ok.md");
  assert.deepEqual(refs.map((r) => r.path), ["ok.md"]);
});

test("renderSkillContent shape", () => {
  const text = renderSkillContent(
    {
      name: "demo",
      description: "d",
      modelInvocable: true,
      userInvocable: true,
      dir: "/tmp/demo",
      skillFile: "/tmp/demo/SKILL.md",
      source: "skills",
    },
    "Do the thing.",
    [{ path: "scripts/a.sh" }],
  );
  assert.match(text, /<skill_content name="demo">/);
  assert.match(text, /resourceBase: \/tmp\/demo/);
  assert.match(text, /scripts\/a\.sh/);
  assert.match(text, /<skill_instructions>\nDo the thing\.\n<\/skill_instructions>/);
});
