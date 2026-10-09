import type { Interface } from "node:readline";
import type { ApprovalAnswer, ApprovalPluginOptions } from "@typescript-agent-harness/permissions";
import { bold, cyan, dim, useColor, yellow } from "./markdown.js";

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

const PREVIEW_LINES = 8;
const PREVIEW_WIDTH = 160;

/** Approval card: what will run, a short preview, then the answer keys. */
export function formatPrompt(call: { name: string; arguments: unknown }, color: boolean): string {
  const paint = (style: (s: string) => string) => (s: string) => (color ? style(s) : s);
  const [frame, strong, faint, code] = [paint(yellow), paint(bold), paint(dim), paint(cyan)];
  const a = (call.arguments ?? {}) as Record<string, unknown>;

  let title: string;
  let body: string[];
  if (call.name === "execute_command") {
    const args = Array.isArray(a.args) ? a.args.join(" ") : "";
    title = strong("Run command");
    body = [code(`$ ${String(a.program ?? "")} ${args}`.trimEnd())];
  } else if (call.name === "write_file") {
    const content = typeof a.content === "string" ? a.content : "";
    const lines = content.split("\n");
    title = `${strong("Write file")}  ${code(String(a.path ?? ""))} ${faint(`(${content.length} chars)`)}`;
    body = lines.slice(0, PREVIEW_LINES).map((l) => faint(l.slice(0, PREVIEW_WIDTH)));
    if (lines.length > PREVIEW_LINES) body.push(faint(`… ${lines.length - PREVIEW_LINES} more lines`));
  } else {
    title = strong(`Call ${call.name}`);
    body = [faint(JSON.stringify(call.arguments).slice(0, PREVIEW_WIDTH))];
  }

  const keys = [
    `${strong("y")} ${faint("allow once")}`,
    `${strong("a")} ${faint(`always allow ${call.name}`)}`,
    `${strong("n")} ${faint("/ Enter reject")}`,
  ].join(faint("  ·  "));
  return [
    "",
    `${frame("╭─")} ${title}`,
    ...body.map((l) => `${frame("│")} ${l}`),
    frame("╰─"),
    `  ${keys}  ${frame("›")} `,
  ].join("\n");
}

/** Chat asks this when a turn hits the step limit; continuing resumes the same turn. */
export function formatContinuePrompt(maxSteps: number, color: boolean): string {
  const paint = (style: (s: string) => string) => (s: string) => (color ? style(s) : s);
  const [frame, strong, faint] = [paint(yellow), paint(bold), paint(dim)];
  const keys = [`${strong("Enter")} ${faint("continue")}`, `${strong("n")} ${faint("stop")}`].join(faint("  ·  "));
  return `\n${strong(`Step limit reached (${maxSteps} rounds this turn).`)}  ${keys}  ${frame("›")} `;
}

export function wantsContinue(line: string | undefined): boolean {
  if (line === undefined) return false;
  const s = line.trim().toLowerCase();
  return s === "" || s === "y" || s === "yes";
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
    process.stdout.write(formatPrompt(call, useColor()));
    if (!signal) return parseAnswer(await reader.next());
    if (signal.aborted) return "no";
    const aborted = new Promise<undefined>((resolve) =>
      signal.addEventListener("abort", () => resolve(undefined), { once: true }),
    );
    const line = await Promise.race([reader.next(), aborted]);
    return signal.aborted ? "no" : parseAnswer(line);
  };
}
