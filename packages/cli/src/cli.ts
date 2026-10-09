#!/usr/bin/env node
import { parseArgv, usage } from "./args.js";

// Loading node:sqlite (session storage) prints an ExperimentalWarning that means nothing to CLI users.
const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === "string" ? warning : warning.message;
  if (message.startsWith("SQLite is an experimental feature")) return;
  emitWarning(warning, ...rest);
}) as typeof process.emitWarning;

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));

  if (flags.command === "help" || flags.command === "-h" || flags.command === "--help") {
    console.log(usage());
    return;
  }

  if (flags.command === "version") {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (flags.command === "init") {
    const { initProject, nextSteps } = await import("./init.js");
    const { formatCommand, installCommand } = await import("./install.js");
    const { isProject } = await import("./project.js");
    console.log(initProject(flags.cwd).join("\n"));
    if (!isProject(flags.cwd)) return;
    const cmd = installCommand(flags.cwd);
    if (!flags.install) {
      console.log(nextSteps(formatCommand(cmd)).join("\n"));
      return;
    }
    const { spawnSync } = await import("node:child_process");
    console.log(`\n[tah] ${formatCommand(cmd)}`);
    const result = spawnSync(cmd.command, cmd.args, {
      cwd: flags.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      if (result.error) console.error(`[tah] ${result.error.message}`);
      console.error(`[tah] install failed — fix the error above, then run: ${formatCommand(cmd)}`);
      console.log(nextSteps(formatCommand(cmd)).join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(nextSteps().join("\n"));
    return;
  }

  if (flags.command === "sessions") {
    const { listSavedSessions } = await import("./runtime.js");
    console.log(await listSavedSessions(flags.cwd));
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
  const {
    bootRuntime,
    describeSessions,
    endTurn,
    openChatSession,
    openSessionByRef,
    runPrompt,
  } = await import("./runtime.js");
  const { createAsk, formatContinuePrompt, lineReader, wantsContinue } = await import("./approve.js");
  const { useColor } = await import("./markdown.js");
  const readline = await import("node:readline");
  const tty = Boolean(process.stdin.isTTY);

  if (flags.command === "run") {
    if (!flags.prompt) {
      console.error("tah run requires a prompt");
      process.exitCode = 1;
      return;
    }
    // terminal:false keeps the TTY in cooked mode, so Ctrl+C stays a real SIGINT that exits `run`.
    const rl = tty
      ? readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: false,
        })
      : undefined;
    try {
      const { runtime, streamed } = await bootRuntime(flags, {
        ask: createAsk(rl && lineReader(rl)),
      });
      try {
        await runPrompt(runtime, flags, streamed);
      } finally {
        await runtime.stop();
      }
    } finally {
      rl?.close();
    }
    return;
  }

  if (flags.command === "chat" && tty && process.stdout.isTTY && !flags.plain) {
    const { runTui } = await import("./tui/run.js");
    await runTui(flags);
    return;
  }

  if (flags.command === "chat") {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: tty,
    });
    const lines = lineReader(rl);
    let booted;
    try {
      booted = await bootRuntime(flags, { ask: createAsk(tty ? lines : undefined) });
    } catch (err) {
      rl.close();
      throw err;
    }
    const { runtime, streamed } = booted;
    const prompt = () => process.stdout.write("you> ");
    try {
      let { session, resumed } = await openChatSession(runtime, flags);
      let running = false;
      rl.on("SIGINT", () => {
        if (running) void session.cancel();
        else rl.close();
      });
      console.log(
        "tah chat  —  /exit  /reset  /sessions  /resume <id|n>  /fork [turns]  (Ctrl+C stops the current turn)",
      );
      if (resumed) {
        console.log(`[tah] resumed session ${session.id}`);
      } else {
        console.log(`[tah] session ${session.id}`);
      }
      prompt();
      for (let raw = await lines.next(); raw !== undefined; raw = await lines.next()) {
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
        const [command, arg] = line.split(/\s+/, 2);
        if (command === "/sessions" || command === "/resume" || command === "/fork") {
          try {
            if (command === "/sessions") {
              console.log(await describeSessions(runtime, session.id));
            } else if (command === "/resume") {
              if (!arg) throw new Error("usage: /resume <id|n>");
              session = await openSessionByRef(runtime, arg);
              console.log(`[tah] resumed session ${session.id}`);
            } else {
              if (arg !== undefined && !/^\d+$/.test(arg)) throw new Error("usage: /fork [turns]");
              const from = session.id;
              session = await runtime
                .get(SESSION)
                .fork(from, arg === undefined ? {} : { turns: Number(arg) });
              const turns = session.messages.filter((m) => m.role === "user").length;
              console.log(`[tah] forked ${from} → ${session.id} (${turns} turn(s) kept; original unchanged)`);
            }
          } catch (err) {
            console.error(`[tah] ${err instanceof Error ? err.message : String(err)}`);
          }
          prompt();
          continue;
        }
        running = true;
        try {
          let from = session.steps.length;
          let result = await session.run(line);
          endTurn(result, session, flags.quiet, streamed, from);
          while (result.finishReason === "max_steps" && tty) {
            process.stdout.write(formatContinuePrompt(flags.maxSteps, useColor()));
            running = false;
            if (!wantsContinue(await lines.next())) break;
            running = true;
            from = session.steps.length;
            result = await session.resume();
            endTurn(result, session, flags.quiet, streamed, from);
          }
        } catch (err) {
          streamed.flush();
          if (streamed.on) process.stdout.write("\n");
          streamed.on = false;
          streamed.midLine = false;
          if (session.state === "cancelled") {
            console.log("[tah] turn cancelled — history kept; keep chatting or /exit");
          } else {
            console.error(
              `[tah] turn failed: ${err instanceof Error ? err.message : String(err)} — history kept; try again`,
            );
          }
        } finally {
          running = false;
        }
        prompt();
      }
      if (flags.persist && !flags.quiet) {
        console.log(
          `[tah] session ${session.id} saved — continue with: tah chat --session ${session.id}`,
        );
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

main().catch(async (err) => {
  const { ProjectError } = await import("./project.js");
  console.error(err instanceof ProjectError ? err.message : err);
  process.exitCode = 1;
});
