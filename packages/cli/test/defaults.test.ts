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

test("parseArgv: agent-host defaults host 0.0.0.0 and port 7800; serve stays 7420", () => {
  const serve = parseArgv(["serve"]);
  assert.equal(serve.command, "serve");
  assert.equal(serve.port, 7420);

  const host = parseArgv(["agent-host"]);
  assert.equal(host.command, "agent-host");
  assert.equal(host.port, 7800);
  assert.equal(host.listenHost, "0.0.0.0");
  assert.equal(host.projectId ?? "", "");

  const custom = parseArgv([
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--project-id",
    "proj_a",
    "agent-host",
  ]);
  assert.equal(custom.listenHost, "127.0.0.1");
  assert.equal(custom.port, 0);
  assert.equal(custom.projectId, "proj_a");

  assert.equal(parseArgv(["--port", "0", "serve"]).port, 0);
  assert.throws(() => parseArgv(["--host"]), /--host requires/);
  assert.throws(() => parseArgv(["--project-id"]), /--project-id requires/);
});
