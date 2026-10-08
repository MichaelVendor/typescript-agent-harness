const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
const italic = sgr(3, 23);
const underline = sgr(4, 24);
const strike = sgr(9, 29);
export const cyan = sgr(36, 39);
export const yellow = sgr(33, 39);

export function useColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(stream.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

function styleText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) =>
      label === url ? underline(url) : `${underline(label)}${dim(` (${url})`)}`,
    )
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a?: string, b?: string) => bold(a ?? b ?? ""))
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]*?[^\s*])\*(?!\w)/g, (_, pre: string, s: string) => pre + italic(s))
    .replace(/~~(.+?)~~/g, (_, s: string) => strike(s));
}

/** Inline code is styled verbatim; emphasis/link syntax only applies outside backticks. */
export function renderInline(line: string): string {
  return line
    .split(/(`[^`\n]+`)/)
    .map((part, i) => (i % 2 === 1 ? cyan(part.slice(1, -1)) : styleText(part)))
    .join("");
}

export type MarkdownState = { fence: string };

export function renderLine(line: string, state: MarkdownState): string {
  const fence = /^\s*(`{3,}|~{3,})\s*(\S*)/.exec(line);
  if (state.fence) {
    if (fence && !fence[2] && fence[1]!.startsWith(state.fence)) {
      state.fence = "";
      return dim("╰─");
    }
    return `${dim("│")} ${line}`;
  }
  if (fence) {
    state.fence = fence[1]!;
    return dim(`╭─ ${fence[2] ?? ""}`.trimEnd());
  }

  const heading = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
  if (heading) {
    const text = bold(renderInline(heading[2]!));
    return heading[1] === "#" ? underline(text) : text;
  }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return dim("─".repeat(40));

  const quote = /^(\s*)>\s?(.*)$/.exec(line);
  if (quote) return `${quote[1]}${dim("│")} ${renderInline(quote[2]!)}`;

  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1]}• ${renderInline(bullet[2]!)}`;

  const ordered = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line);
  if (ordered) return `${ordered[1]}${ordered[2]} ${renderInline(ordered[3]!)}`;

  if (/^\s*\|.*\|\s*$/.test(line)) {
    if (/^[\s|:-]+$/.test(line)) return dim(line);
    return line
      .split("|")
      .map((cell) => renderInline(cell))
      .join(dim("|"));
  }

  return renderInline(line);
}

export function renderMarkdown(text: string): string {
  const state: MarkdownState = { fence: "" };
  return text
    .split("\n")
    .map((line) => renderLine(line, state))
    .join("\n");
}

export type MarkdownStream = { push(text: string): void; flush(): void };

/**
 * Styles each line once it is complete. `flush()` writes the unfinished line
 * and must be called before anything else is printed (logs, prompts, turn end).
 */
export function createMarkdownStream(write: (s: string) => void): MarkdownStream {
  const state: MarkdownState = { fence: "" };
  let pending = "";
  return {
    push(text) {
      pending += text;
      for (let i = pending.indexOf("\n"); i >= 0; i = pending.indexOf("\n")) {
        write(`${renderLine(pending.slice(0, i), state)}\n`);
        pending = pending.slice(i + 1);
      }
    },
    flush() {
      if (pending) write(renderLine(pending, state));
      pending = "";
    },
  };
}
