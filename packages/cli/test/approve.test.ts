import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { Runtime } from "@typescript-agent-harness/core";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import {
  createAsk,
  formatContinuePrompt,
  formatPrompt,
  lineReader,
  parseAnswer,
  wantsContinue,
} from "../dist/approve.js";
import { bootRuntime } from "../dist/runtime.js";

test("parseArgv: --yes / -y", () => {
  assert.equal(parseArgv(["run", "hi"]).yes, false);
  assert.equal(parseArgv(["--yes", "run", "hi"]).yes, true);
  assert.equal(parseArgv(["-y", "chat"]).yes, true);
});

test("parseArgv: --system-file", () => {
  assert.equal(parseArgv(["chat"]).systemFile, "");
  assert.equal(parseArgv(["--system-file", "role.md", "chat"]).systemFile, "role.md");
  assert.throws(() => parseArgv(["--system-file"]), /requires a path/);
});

test("parseAnswer: y/a accepted, anything else is no", () => {
  assert.equal(parseAnswer("y"), "yes");
  assert.equal(parseAnswer(" YES "), "yes");
  assert.equal(parseAnswer("a"), "always");
  assert.equal(parseAnswer(""), "no");
  assert.equal(parseAnswer(undefined), "no");
  assert.equal(parseAnswer("sure"), "no");
});

test("cancelled approval answers no and leaves the next line for the chat loop", async () => {
  const input = new PassThrough();
  const rl = createInterface({ input, terminal: false });
  const reader = lineReader(rl);
  const ask = createAsk(reader);
  const controller = new AbortController();
  const out = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    const answer = ask({ id: "c", name: "write_file", arguments: {} }, controller.signal);
    controller.abort();
    assert.equal(await answer, "no");
  } finally {
    process.stdout.write = out;
  }
  input.write("next chat line\n");
  assert.equal(await reader.next(), "next chat line");
  rl.close();
});

test("formatPrompt shows a card with the command or write preview and the answer keys", () => {
  const keys = (tool: string) =>
    `  y allow once  ·  a always allow ${tool}  ·  n / Enter reject  › `;
  assert.equal(
    formatPrompt({ name: "execute_command", arguments: { program: "npm", args: ["test"] } }, false),
    ["", "╭─ Run command", "│ $ npm test", "╰─", keys("execute_command")].join("\n"),
  );
  const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
  assert.equal(
    formatPrompt({ name: "write_file", arguments: { path: "a.ts", content } }, false),
    [
      "",
      `╭─ Write file  a.ts (${content.length} chars)`,
      ...Array.from({ length: 8 }, (_, i) => `│ line ${i + 1}`),
      "│ … 2 more lines",
      "╰─",
      keys("write_file"),
    ].join("\n"),
  );
  const colored = formatPrompt({ name: "write_file", arguments: { path: "a.ts", content: "x" } }, true);
  assert.match(colored, /\x1b\[33m╭─/);
  assert.equal(colored.replace(/\x1b\[\d+m/g, ""), formatPrompt({ name: "write_file", arguments: { path: "a.ts", content: "x" } }, false));
});

test("continue prompt: Enter or y continues; n, other text, or EOF stops", () => {
  assert.equal(
    formatContinuePrompt(32, false),
    "\nStep limit reached (32 rounds this turn).  Enter continue  ·  n stop  › ",
  );
  assert.equal(formatContinuePrompt(32, true).replace(/\x1b\[\d+m/g, ""), formatContinuePrompt(32, false));
  assert.equal(wantsContinue(""), true);
  assert.equal(wantsContinue(" Y "), true);
  assert.equal(wantsContinue("yes"), true);
  assert.equal(wantsContinue("n"), false);
  assert.equal(wantsContinue("stop"), false);
  assert.equal(wantsContinue(undefined), false);
});

test("bootRuntime asks before write_file; --yes skips the question", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-approve-"));
  const flags = {
    ...parseArgv(["run", "x"]),
    cwd,
    mock: true,
    persist: false,
    quiet: true,
  };
  const asked: string[] = [];
  const ask = async (call: { name: string }) => {
    asked.push(call.name);
    return "no" as const;
  };
  const toolCtx = (runtime: Runtime) => ({
    sessionId: "s",
    callId: "c",
    signal: new AbortController().signal,
    runtime: runtime.context(),
  });
  const call = { id: "c", name: "write_file", arguments: { path: "out.txt", content: "hi" } };

  const gated = await bootRuntime(flags, { ask });
  const rejected = await gated.runtime.get(TOOLS).execute(call, toolCtx(gated.runtime));
  assert.equal(rejected.ok, false);
  assert.equal(existsSync(path.join(cwd, "out.txt")), false);
  assert.deepEqual(asked, ["write_file"]);
  await gated.runtime.stop();

  const yes = await bootRuntime({ ...flags, yes: true }, { ask });
  const ok = await yes.runtime.get(TOOLS).execute(call, toolCtx(yes.runtime));
  assert.equal(ok.ok, true);
  assert.deepEqual(asked, ["write_file"]);
  await yes.runtime.stop();
});
