const sgr = (open: number, close: number) => (s: string) => `\x1b[${open}m${s}\x1b[${close}m`;
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
const italic = sgr(3, 23);
const underline = sgr(4, 24);
const strike = sgr(9, 29);
export const cyan = sgr(36, 39);
export const yellow = sgr(33, 39);

/** SGR open code → the code that closes it; used to re-open styles across wrapped lines. */
const CLOSE_OF: Record<string, string> = { 1: "22", 2: "22", 3: "23", 4: "24", 9: "29", 33: "39", 36: "39" };

export function useColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(stream.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}

// East Asian wide / emoji ranges (terminal cells = 2).
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f000, 0x1faff], [0x20000, 0x3fffd],
];

function charWidth(cp: number): number {
  if (
    (cp >= 0x300 && cp <= 0x36f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x20e3
  ) {
    return 0;
  }
  return WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1;
}

/** U+FE0F after a narrow symbol (⚠️, 1️⃣) asks for emoji presentation, which terminals draw two cells wide. */
export function displayWidth(s: string): number {
  let w = 0;
  let prev = 0;
  for (const ch of s.replace(/\x1b\[\d+m/g, "")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f && prev === 1) {
      w += 1;
      prev = 2;
      continue;
    }
    if (charWidth(cp) > 0) prev = charWidth(cp);
    w += charWidth(cp);
  }
  return w;
}

/** A visible character plus the zero-width marks that belong to it. */
const CLUSTER = /[^\s\x1b][\u0300-\u036f\u200b-\u200f\ufe00-\ufe0f\u20e3]*/gu;

/** Word-wraps styled text to `width` cells; open styles are closed and re-opened at each break. */
export function wrapStyled(s: string, width: number): string[] {
  const tokens = s.match(new RegExp(`\\x1b\\[\\d+m|\\s|${CLUSTER.source}`, "gu")) ?? [];
  const units: string[] = [];
  const narrowWord = (x: string) => !x.startsWith("\x1b") && !/\s/.test(x) && displayWidth(x) === x.length;
  for (const t of tokens) {
    const last = units[units.length - 1];
    if (last !== undefined && narrowWord(t) && narrowWord(last)) {
      units[units.length - 1] = last + t;
    } else {
      units.push(t);
    }
  }

  const lines: string[] = [];
  let active: string[] = [];
  let line = "";
  let w = 0;
  const breakLine = () => {
    lines.push(line.replace(/ +$/, "") + active.map((c) => `\x1b[${CLOSE_OF[c]}m`).join(""));
    line = active.map((c) => `\x1b[${c}m`).join("");
    w = 0;
  };
  for (const u of units) {
    const code = /^\x1b\[(\d+)m$/.exec(u)?.[1];
    if (code !== undefined) {
      active = code in CLOSE_OF ? [...active, code] : active.filter((c) => CLOSE_OF[c] !== code);
      line += u;
      continue;
    }
    const uw = displayWidth(u);
    if (w > 0 && w + uw > width) {
      breakLine();
      if (/^\s$/.test(u)) continue;
    }
    if (uw <= width) {
      line += u;
      w += uw;
      continue;
    }
    for (const ch of u.match(CLUSTER) ?? []) {
      const cw = displayWidth(ch);
      if (w > 0 && w + cw > width) breakLine();
      line += ch;
      w += cw;
    }
  }
  lines.push(line);
  return lines;
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

/** Inline code is styled verbatim; emphasis may wrap around it (`**see `x`**`). */
export function renderInline(line: string): string {
  const codes: string[] = [];
  const masked = line.replace(/`([^`\n]+)`/g, (_, c: string) => `\uE000${codes.push(c) - 1}\uE001`);
  return styleText(masked).replace(/\uE000(\d+)\uE001/g, (_, i: string) => cyan(codes[Number(i)]!));
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

  return renderInline(line);
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const MIN_COLUMN = 6;

function splitCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function pad(s: string, width: number, align: string): string {
  const gap = Math.max(0, width - displayWidth(s));
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") return " ".repeat(gap >> 1) + s + " ".repeat(gap - (gap >> 1));
  return s + " ".repeat(gap);
}

/** GFM table → box table sized to `width` cells; rows without a separator line stay as text. */
export function renderTable(rows: string[], width: number): string[] {
  if (rows.length < 2 || !TABLE_SEPARATOR.test(rows[1]!)) {
    return rows.map((r) => r.split("|").map(renderInline).join(dim("|")));
  }
  const align = splitCells(rows[1]!).map((c) =>
    c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left",
  );
  const parsed = [rows[0]!, ...rows.slice(2)].map((r) => splitCells(r).map(renderInline));
  const n = Math.max(...parsed.map((r) => r.length));
  const grid = parsed.map((r, ri) =>
    Array.from({ length: n }, (_, i) => (ri === 0 ? bold(r[i] ?? "") : (r[i] ?? ""))),
  );

  const widths = Array.from({ length: n }, (_, i) => Math.max(1, ...grid.map((r) => displayWidth(r[i]!))));
  const room = width - (3 * n + 1);
  for (let total = widths.reduce((a, b) => a + b, 0); total > room; total -= 1) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest]! <= MIN_COLUMN) break;
    widths[widest]! -= 1;
  }

  const rule = (l: string, m: string, r: string) => dim(l + widths.map((w) => "─".repeat(w + 2)).join(m) + r);
  const out = [rule("┌", "┬", "┐")];
  grid.forEach((row, ri) => {
    const cells = row.map((c, i) => wrapStyled(c, widths[i]!));
    const height = Math.max(...cells.map((c) => c.length));
    for (let k = 0; k < height; k += 1) {
      const parts = cells.map((c, i) => ` ${pad(c[k] ?? "", widths[i]!, align[i] ?? "left")} `);
      out.push(dim("│") + parts.join(dim("│")) + dim("│"));
    }
    if (ri === 0 && grid.length > 1) out.push(rule("├", "┼", "┤"));
  });
  out.push(rule("└", "┴", "┘"));
  return out;
}

/** Line renderer that holds table rows until the table ends, so columns can be sized. */
function createRenderer(width: () => number) {
  const state: MarkdownState = { fence: "" };
  let table: string[] = [];
  const endTable = () => {
    const out = table.length ? renderTable(table, width()) : [];
    table = [];
    return out;
  };
  return {
    line(line: string): string[] {
      if (!state.fence && isTableRow(line)) {
        table.push(line);
        return [];
      }
      return [...endTable(), renderLine(line, state)];
    },
    end: endTable,
  };
}

const terminalWidth = () => process.stdout.columns || 80;

export function renderMarkdown(text: string, width: () => number = terminalWidth): string {
  const r = createRenderer(width);
  return [...text.split("\n").flatMap((l) => r.line(l)), ...r.end()].join("\n");
}

export type MarkdownStream = { push(text: string): void; flush(): void };

/**
 * Styles each line once it is complete (tables once the table ends). `flush()` writes
 * whatever is held back and must be called before anything else is printed.
 */
export function createMarkdownStream(
  write: (s: string) => void,
  width: () => number = terminalWidth,
): MarkdownStream {
  const r = createRenderer(width);
  let pending = "";
  return {
    push(text) {
      pending += text;
      for (let i = pending.indexOf("\n"); i >= 0; i = pending.indexOf("\n")) {
        for (const l of r.line(pending.slice(0, i))) write(`${l}\n`);
        pending = pending.slice(i + 1);
      }
    },
    flush() {
      const partial = pending;
      pending = "";
      const out = [...(partial ? r.line(partial) : []), ...r.end()];
      if (out.length) write(partial ? out.join("\n") : `${out.join("\n")}\n`);
    },
  };
}
