#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SESSION } from "@typescript-agent-harness/agent";
import { parseArgv, usage } from "./args.js";
import { loadCliEnv } from "./env.js";
import { bootRuntime, endTurn, runPrompt } from "./runtime.js";

async function chat(flags: ReturnType<typeof parseArgv>): Promise<void> {
  const { runtime, streamed } = await bootRuntime(flags);
  let session = await runtime.get(SESSION).create();
  const rl = readline.createInterface({ input, output });
  console.log("tah chat  —  /exit  /reset");
  try {
    while (true) {
      const line = (await rl.question("you> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/reset") {
        session = await runtime.get(SESSION).create();
        console.log(`[tah] new session ${session.id}`);
        continue;
      }
      const result = await session.run(line);
      endTurn(result.text, session, flags.quiet, streamed);
    }
  } finally {
    rl.close();
    await runtime.stop();
  }
}

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));
  loadCliEnv(flags.cwd);

  if (flags.command === "help" || flags.command === "-h" || flags.command === "--help") {
    console.log(usage());
    return;
  }

  if (flags.onceMs >= 0 && flags.command !== "run") {
    console.error("--once is only valid with tah run");
    process.exitCode = 1;
    return;
  }

  if (flags.command === "run") {
    if (!flags.prompt) {
      console.error("tah run requires a prompt");
      process.exitCode = 1;
      return;
    }
    const { runtime, streamed } = await bootRuntime(flags);
    try {
      await runPrompt(runtime, flags, streamed);
    } finally {
      await runtime.stop();
    }
    return;
  }

  if (flags.command === "chat") {
    await chat(flags);
    return;
  }

  console.error(usage());
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
