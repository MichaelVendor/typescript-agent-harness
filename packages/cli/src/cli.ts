#!/usr/bin/env node
import { parseArgv, usage } from "./args.js";

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));

  if (flags.command === "help" || flags.command === "-h" || flags.command === "--help") {
    console.log(usage());
    return;
  }

  const { loadCliEnv, hasLlmKey } = await import("./env.js");
  loadCliEnv(flags.cwd);

  if (!flags.mock && !hasLlmKey()) {
    console.error(
      "tah: no DEEPSEEK_API_KEY or OPENAI_API_KEY. Set one in <cwd>/.env or pass --mock.",
    );
    process.exitCode = 1;
    return;
  }

  if (flags.onceMs >= 0 && flags.command !== "run") {
    console.error("--once is only valid with tah run");
    process.exitCode = 1;
    return;
  }

  const { SESSION } = await import("@typescript-agent-harness/agent");
  const { bootRuntime, endTurn, runPrompt } = await import("./runtime.js");

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
    const { runtime, streamed } = await bootRuntime(flags);
    let session = await runtime.get(SESSION).create();
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    console.log("tah chat  —  /exit  /reset");
    const prompt = () => process.stdout.write("you> ");
    try {
      prompt();
      for await (const raw of rl) {
        const line = raw.trim();
        if (!line) {
          prompt();
          continue;
        }
        if (line === "/exit" || line === "/quit") break;
        if (line === "/reset") {
          session = await runtime.get(SESSION).create();
          console.log(`[tah] new session ${session.id}`);
          prompt();
          continue;
        }
        const result = await session.run(line);
        endTurn(result, session, flags.quiet, streamed);
        prompt();
      }
    } finally {
      rl.close();
      await runtime.stop();
    }
    return;
  }

  console.error(usage());
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
