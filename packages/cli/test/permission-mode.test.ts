import assert from "node:assert/strict";
import { test } from "node:test";
import { cycleMode, decide } from "../src/permission-mode.ts";

test("manual asks, accept-edits allows file edits, plan blocks mutations", () => {
  assert.equal(decide("manual", "write_file"), "ask");
  assert.equal(decide("manual", "execute_command"), "ask");
  assert.equal(decide("accept-edits", "edit_file"), "yes");
  assert.equal(decide("accept-edits", "write_file"), "yes");
  assert.equal(decide("accept-edits", "execute_command"), "ask");
  assert.equal(decide("plan", "write_file"), "no");
  assert.equal(decide("plan", "execute_command"), "no");
  assert.equal(decide("plan", "browser_open"), "no");
  assert.equal(decide("plan", "read_file"), "ask");
});

test("cycleMode walks manual, accept-edits, plan", () => {
  assert.equal(cycleMode("manual"), "accept-edits");
  assert.equal(cycleMode("accept-edits"), "plan");
  assert.equal(cycleMode("plan"), "manual");
});
