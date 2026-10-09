import stringWidth from "string-width";

/** Multi-line input. `col` counts code points, so CJK and emoji move as one character. */
export type Editor = { lines: string[]; row: number; col: number };

export const emptyEditor = (): Editor => ({ lines: [""], row: 0, col: 0 });

const chars = (s: string) => Array.from(s);

export function editorText(e: Editor): string {
  return e.lines.join("\n");
}

export function isBlank(e: Editor): boolean {
  return editorText(e).trim() === "";
}

/** Typed text or a paste; newlines split lines, `\r\n` and `\r` count as one. */
export function insert(e: Editor, text: string): Editor {
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  const line = chars(e.lines[e.row] ?? "");
  const before = line.slice(0, e.col).join("");
  const after = line.slice(e.col).join("");
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    const lines = [...e.lines];
    lines[e.row] = before + first + after;
    return { lines, row: e.row, col: e.col + chars(first).length };
  }
  const last = parts.at(-1) ?? "";
  const inserted = [before + first, ...parts.slice(1, -1), last + after];
  const lines = [...e.lines.slice(0, e.row), ...inserted, ...e.lines.slice(e.row + 1)];
  return { lines, row: e.row + parts.length - 1, col: chars(last).length };
}

export function backspace(e: Editor): Editor {
  if (e.col > 0) {
    const line = chars(e.lines[e.row] ?? "");
    line.splice(e.col - 1, 1);
    const lines = [...e.lines];
    lines[e.row] = line.join("");
    return { lines, row: e.row, col: e.col - 1 };
  }
  if (e.row === 0) return e;
  const prev = e.lines[e.row - 1] ?? "";
  const lines = [...e.lines];
  lines.splice(e.row - 1, 2, prev + (e.lines[e.row] ?? ""));
  return { lines, row: e.row - 1, col: chars(prev).length };
}

export function deleteForward(e: Editor): Editor {
  const line = chars(e.lines[e.row] ?? "");
  if (e.col < line.length) {
    line.splice(e.col, 1);
    const lines = [...e.lines];
    lines[e.row] = line.join("");
    return { ...e, lines };
  }
  if (e.row === e.lines.length - 1) return e;
  const lines = [...e.lines];
  lines.splice(e.row, 2, (e.lines[e.row] ?? "") + (e.lines[e.row + 1] ?? ""));
  return { ...e, lines };
}

export type Move = "left" | "right" | "up" | "down" | "home" | "end";

export function move(e: Editor, to: Move): Editor {
  const len = (row: number) => chars(e.lines[row] ?? "").length;
  switch (to) {
    case "left":
      if (e.col > 0) return { ...e, col: e.col - 1 };
      return e.row > 0 ? { ...e, row: e.row - 1, col: len(e.row - 1) } : e;
    case "right":
      if (e.col < len(e.row)) return { ...e, col: e.col + 1 };
      return e.row < e.lines.length - 1 ? { ...e, row: e.row + 1, col: 0 } : e;
    case "up":
      return e.row > 0 ? { ...e, row: e.row - 1, col: Math.min(e.col, len(e.row - 1)) } : e;
    case "down":
      return e.row < e.lines.length - 1
        ? { ...e, row: e.row + 1, col: Math.min(e.col, len(e.row + 1)) }
        : e;
    case "home":
      return { ...e, col: 0 };
    case "end":
      return { ...e, col: len(e.row) };
  }
}

/** Terminal column of the cursor: wide characters take two cells. */
export function cursorColumn(e: Editor): number {
  return stringWidth(chars(e.lines[e.row] ?? "").slice(0, e.col).join(""));
}

/**
 * Hard-wraps every line at `width` cells and finds the cursor's cell in the result,
 * so what is drawn and where the terminal cursor goes always agree.
 */
export function layoutEditor(e: Editor, width: number): { rows: string[]; cursor: { x: number; y: number } } {
  const w = Math.max(1, width);
  const rows: string[] = [];
  let cursor = { x: 0, y: 0 };
  e.lines.forEach((line, lineIndex) => {
    let row = "";
    let cells = 0;
    chars(line).forEach((ch, i) => {
      const cw = stringWidth(ch);
      if (cells + cw > w) {
        rows.push(row);
        row = "";
        cells = 0;
      }
      if (lineIndex === e.row && i === e.col) cursor = { x: cells, y: rows.length };
      row += ch;
      cells += cw;
    });
    if (lineIndex === e.row && e.col >= chars(line).length) {
      cursor = cells >= w ? { x: 0, y: rows.length + 1 } : { x: cells, y: rows.length };
      if (cells >= w) {
        rows.push(row);
        row = "";
      }
    }
    rows.push(row);
  });
  return { rows, cursor };
}

/** Text typed so far when the input is a single `/command` with no arguments yet. */
export function slashQuery(e: Editor): string | undefined {
  if (e.lines.length !== 1) return undefined;
  const line = e.lines[0] ?? "";
  return /^\/\S*$/.test(line) ? line : undefined;
}
