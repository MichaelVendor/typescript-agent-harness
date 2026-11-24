import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_TEAM_MEMBERS,
  loadTeamSettings,
  saveTeamSettings,
} from "../dist/team-settings.js";

test("loadTeamSettings returns defaults when tah.team.json is missing", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-team-"));
  assert.deepEqual(loadTeamSettings(cwd), DEFAULT_TEAM_MEMBERS);
});

test("saveTeamSettings writes tah.team.json and reloads", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-team-"));
  const members = [
    { id: "tl", displayName: "Lead", persona: "Coordinates the room." },
    { id: "coder", displayName: "Coder", persona: "Implements changes." },
  ];
  const view = saveTeamSettings(cwd, members);
  assert.deepEqual(view.members, members);
  assert.deepEqual(loadTeamSettings(cwd), members);
  const file = JSON.parse(readFileSync(path.join(cwd, "tah.team.json"), "utf8")) as { members: unknown };
  assert.deepEqual(file.members, members);
});

test("saveTeamSettings rejects roster without tl", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-team-"));
  assert.throws(
    () => saveTeamSettings(cwd, [{ id: "researcher", displayName: "R", persona: "x" }]),
    /"tl"/,
  );
});