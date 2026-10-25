/** Closed / failed previews keep this many lines. Transcript (`open`) uses the higher cap. */
const CLOSED_LINES = 8;
const OPEN_LINES = 40;

/** Same SGR as `markdown.ts`, inlined so this module stays free of local imports. */
const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
const dim = sgr(2, 22);
const cyan = sgr(36, 39);
const red = sgr(31, 39);

function paint(line: string, color: boolean): string {
  if (!color) return line;
  if (line.startsWith("- ")) return dim(red(line));
  if (line.startsWith("+ ")) return cyan(line);
  return line;
}

/** Truncates a tool result. When `color` is set, `- ` lines are dim red and `+ ` lines are cyan. */
export function formatToolResult(result: string, opts: { open: boolean; color?: boolean }): string {
  const limit = opts.open ? OPEN_LINES : CLOSED_LINES;
  const color = opts.color === true;
  const lines = result.split("\n");
  const shown = lines.slice(0, limit).map((line) => paint(line, color));
  if (lines.length > limit) {
    const more = `… ${lines.length - limit} more lines`;
    shown.push(color ? dim(more) : more);
  }
  return shown.join("\n");
}
