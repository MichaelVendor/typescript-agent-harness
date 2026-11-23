import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { browserProfileId, playwrightServer, profileDir } from "../dist/browser.js";

test("profileDir is under browser-profiles and differs by id", () => {
  const a = profileDir("/home", "main");
  const b = profileDir("/home", "w1-abc");
  assert.match(a, /browser-profiles/);
  assert.match(b, /browser-profiles/);
  assert.notEqual(a, b);
  assert.equal(a, path.join("/home", ".tah", "browser-profiles", "main"));
  assert.equal(b, path.join("/home", ".tah", "browser-profiles", "w1-abc"));
});

test("browserProfileId prefers explicit id then TAH_BROWSER_PROFILE_ID then main", () => {
  const prev = process.env.TAH_BROWSER_PROFILE_ID;
  try {
    assert.equal(browserProfileId("x"), "x");
    process.env.TAH_BROWSER_PROFILE_ID = "from-env";
    assert.equal(browserProfileId(), "from-env");
    delete process.env.TAH_BROWSER_PROFILE_ID;
    assert.equal(browserProfileId(), "main");
  } finally {
    if (prev === undefined) delete process.env.TAH_BROWSER_PROFILE_ID;
    else process.env.TAH_BROWSER_PROFILE_ID = prev;
  }
});

test("playwrightServer --user-data-dir follows profile id", () => {
  const main = playwrightServer({ cwd: "/w", homeDir: "/h", headless: true, profileId: "main" });
  const worker = playwrightServer({ cwd: "/w2", homeDir: "/h", headless: true, profileId: "w9-deadbeef" });
  const mainIdx = main.args.indexOf("--user-data-dir");
  const workerIdx = worker.args.indexOf("--user-data-dir");
  assert.equal(main.args[mainIdx + 1], profileDir("/h", "main"));
  assert.equal(worker.args[workerIdx + 1], profileDir("/h", "w9-deadbeef"));
  assert.notEqual(main.args[mainIdx + 1], worker.args[workerIdx + 1]);
});