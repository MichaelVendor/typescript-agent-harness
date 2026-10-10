import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";

test("parseArgv defaults exec on, persist on, no step limit", () => {
  const flags = parseArgv(["chat"]);
  assert.equal(flags.exec, true);
  assert.equal(flags.execSet, false);
  assert.equal(flags.visionSet, false);
  assert.equal(flags.persist, true);
  assert.equal(flags.maxSteps, Infinity);
});

test("parseArgv accepts --no-exec --no-persist --max-steps", () => {
  const flags = parseArgv([
    "--no-exec",
    "--no-persist",
    "--max-steps",
    "16",
    "chat",
  ]);
  assert.equal(flags.exec, false);
  assert.equal(flags.execSet, true);
  assert.equal(flags.persist, false);
  assert.equal(flags.maxSteps, 16);
});

test("parseArgv --exec stays on; --max-steps rejects non-positive", () => {
  const on = parseArgv(["--exec", "run", "hi"]);
  assert.equal(on.exec, true);
  assert.equal(on.execSet, true);
  assert.throws(() => parseArgv(["--max-steps", "0", "run", "hi"]), /positive/);
});

test("parseArgv --vision sets visionSet", () => {
  const flags = parseArgv(["--vision", "serve"]);
  assert.equal(flags.vision, true);
  assert.equal(flags.visionSet, true);
});
