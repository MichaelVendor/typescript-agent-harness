import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";

const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const cyan = sgr(36, 39);
export const yellow = sgr(33, 39);

export function useColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(stream.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

export type MarkdownOptions = { width?: number; color?: boolean };

const identity = (s: string) => s;
const ANSI_SGR = /\x1b\[[\d;]*m/g;

const noColorStyles = {
  code: identity,
  blockquote: identity,
  html: identity,
  heading: identity,
  firstHeading: identity,
  hr: identity,
  listitem: identity,
  table: identity,
  paragraph: identity,
  strong: identity,
  em: identity,
  codespan: identity,
  del: identity,
  link: identity,
  href: identity,
} as const;

function terminalOptions(opts?: MarkdownOptions): Record<string, unknown> {
  const width = opts?.width !== undefined ? Math.max(40, opts.width) : 80;
  const reflowText = Boolean(opts?.width);
  const color = opts?.color !== false && useColor();
  return color ? { reflowText, width } : { reflowText, width, ...noColorStyles };
}

function parseMarkdown(text: string, opts?: MarkdownOptions): string {
  const marked = new Marked(markedTerminal(terminalOptions(opts)));
  const color = opts?.color !== false && useColor();
  let out = (marked.parse(text, { async: false }) as string).replace(/^\n+|\n+$/g, "");
  if (!color) out = out.replace(ANSI_SGR, "");
  return out;
}

/** Renders Markdown with marked-terminal; surrounding blank lines are trimmed. */
export function renderMarkdown(text: string, opts?: MarkdownOptions): string {
  return parseMarkdown(text, opts);
}

/** `pending()`: raw text received but not yet written as a rendered block. */
export type MarkdownStream = { push(text: string): void; flush(): void; pending(): string };

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^ {0,3}([-*+]|\d+[.)])\s/;

/**
 * Renders one Markdown block at a time (a paragraph, list, table, fenced code…).
 * A block ends at a blank line unless the next line is indented or continues the
 * same list, so the block is written once the next block's first line arrives.
 * Every write ends with a newline. `flush()` writes the rest and must be called
 * before anything else is printed.
 */
export function createMarkdownStream(
  write: (s: string) => void,
  render: (markdown: string) => string = renderMarkdown,
): MarkdownStream {
  let pending = "";
  let block: string[] = [];
  let fence = "";
  let afterBlank = false;

  const emit = () => {
    const text = block.join("\n");
    block = [];
    if (text.trim()) write(`${render(text)}\n`);
  };

  const addLine = (line: string) => {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && !close[2]!.trim() && close[1]![0] === fence[0] && close[1]!.length >= fence.length) {
        fence = "";
      }
      block.push(line);
      return;
    }
    if (!line.trim()) {
      if (block.length) {
        afterBlank = true;
        block.push(line);
      }
      return;
    }
    if (afterBlank) {
      afterBlank = false;
      const continues = /^\s/.test(line) || (LIST_ITEM.test(block[0]!) && LIST_ITEM.test(line));
      if (!continues) {
        emit();
        write("\n");
      }
    }
    const open = FENCE.exec(line);
    if (open) fence = open[1]!;
    block.push(line);
  };

  return {
    push(text) {
      pending += text;
      for (let i = pending.indexOf("\n"); i >= 0; i = pending.indexOf("\n")) {
        addLine(pending.slice(0, i));
        pending = pending.slice(i + 1);
      }
    },
    flush() {
      if (pending) addLine(pending);
      pending = "";
      fence = "";
      afterBlank = false;
      emit();
    },
    pending() {
      return [...block, pending].join("\n").replace(/^\n+/, "");
    },
  };
}
