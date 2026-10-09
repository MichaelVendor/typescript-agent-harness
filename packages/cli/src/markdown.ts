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

const marked = new Marked(markedTerminal());

/** Renders Markdown with marked-terminal; surrounding blank lines are trimmed. */
export function renderMarkdown(text: string): string {
  return (marked.parse(text, { async: false }) as string).replace(/^\n+|\n+$/g, "");
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
