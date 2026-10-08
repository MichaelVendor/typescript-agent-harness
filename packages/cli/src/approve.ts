import type { Interface } from "node:readline";
import type { ApprovalAnswer, ApprovalPluginOptions } from "@typescript-agent-harness/permissions";

export const APPROVAL_TOOLS = ["write_file", "execute_command"];

export type LineReader = { next(): Promise<string | undefined> };

/**
 * One reader shared by the chat loop and approval prompts, so answers never leak into chat.
 * A read abandoned by a cancelled approval is handed to the next caller instead of losing that line.
 */
export function lineReader(rl: Interface): LineReader {
  const it = rl[Symbol.asyncIterator]();
  let pending: Promise<string | undefined> | undefined;
  return {
    next() {
      pending ??= it.next().then((r) => {
        pending = undefined;
        return r.done ? undefined : r.value;
      });
      return pending;
    },
  };
}

export function parseAnswer(line: string | undefined): ApprovalAnswer {
  const s = (line ?? "").trim().toLowerCase();
  if (s === "y" || s === "yes") return "yes";
  if (s === "a" || s === "always") return "always";
  return "no";
}

export function formatCall(call: { name: string; arguments: unknown }): string {
  const a = (call.arguments ?? {}) as Record<string, unknown>;
  if (call.name === "execute_command") {
    const args = Array.isArray(a.args) ? a.args.join(" ") : "";
    return `execute_command: ${String(a.program ?? "")} ${args}`.trimEnd();
  }
  if (call.name === "write_file") {
    const size = typeof a.content === "string" ? a.content.length : 0;
    return `write_file: ${String(a.path ?? "")} (${size} chars)`;
  }
  return `${call.name} ${JSON.stringify(call.arguments).slice(0, 200)}`;
}

/** Without a TTY reader every gated call is rejected, so piped input is never read as an answer. */
export function createAsk(reader: LineReader | undefined): ApprovalPluginOptions["ask"] {
  return async (call, signal) => {
    if (!reader) {
      console.error(
        `\n[tah] ${call.name} needs approval but stdin is not a TTY — rejected (pass --yes to allow)`,
      );
      return "no";
    }
    process.stdout.write(`\n[approve] ${formatCall(call)}\n  allow? [y]es / [n]o / [a]lways: `);
    if (!signal) return parseAnswer(await reader.next());
    if (signal.aborted) return "no";
    const aborted = new Promise<undefined>((resolve) =>
      signal.addEventListener("abort", () => resolve(undefined), { once: true }),
    );
    const line = await Promise.race([reader.next(), aborted]);
    return signal.aborted ? "no" : parseAnswer(line);
  };
}
