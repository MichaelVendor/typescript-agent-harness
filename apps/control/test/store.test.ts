import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openStore } from "../dist/store.js";

test("create user and project; list shows owner; stranger unseen until addMember", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tah-control-"));
  const store = openStore(path.join(dir, "control.db"));

  const owner = store.createUser("alice", "hash-alice");
  const stranger = store.createUser("bob", "hash-bob");
  const project = store.createProject(owner.id, "Alpha");

  assert.equal(project.name, "Alpha");
  assert.deepEqual(store.projectsFor(owner.id), [{ id: project.id, name: "Alpha", role: "owner" }]);
  assert.deepEqual(store.projectsFor(stranger.id), []);
  assert.equal(store.role(project.id, stranger.id), undefined);

  store.addMember(project.id, stranger.id, "member");
  assert.deepEqual(store.projectsFor(stranger.id), [{ id: project.id, name: "Alpha", role: "member" }]);
  assert.equal(store.role(project.id, stranger.id), "member");
  assert.equal(store.role(project.id, owner.id), "owner");
  assert.deepEqual(store.members(project.id), [
    { username: "alice", role: "owner" },
    { username: "bob", role: "member" },
  ]);
});
