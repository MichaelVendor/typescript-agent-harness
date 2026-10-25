import { emptyEditor, isBlank, killLineEnd, killLineStart, killWordBack, type Editor } from "./editor.js";

export type AppMode = "normal" | "transcript" | "history";

/** `transcript` toggles back to `normal`. Any other mode enters `transcript`. */
export function toggleTranscript(mode: AppMode): AppMode {
  return mode === "transcript" ? "normal" : "transcript";
}

const mentionRe = /(?:^|\s)@([^\s@]*)$/;

/** `@query` ending at the cursor on `line`, or undefined when the cursor is not in a mention. */
export function fileMentionQuery(line: string, col: number): string | undefined {
  const before = Array.from(line).slice(0, Math.max(0, col)).join("");
  const match = mentionRe.exec(before);
  return match ? match[1] : undefined;
}

/** Replace the mention ending at `col` with `filePath` and a trailing space. */
export function replaceFileMention(line: string, col: number, filePath: string): { line: string; col: number } {
  const chars = Array.from(line);
  const safeCol = Math.max(0, Math.min(col, chars.length));
  const before = chars.slice(0, safeCol).join("");
  const after = chars.slice(safeCol).join("");
  const match = mentionRe.exec(before);
  if (!match || match[1] === undefined) return { line, col: safeCol };
  const prefix = before.slice(0, before.length - match[1].length - 1);
  const inserted = `${filePath} `;
  const next = prefix + inserted + after;
  return { line: next, col: Array.from(prefix + inserted).length };
}

export function insertFileMention(editor: Editor, filePath: string): Editor {
  const line = editor.lines[editor.row] ?? "";
  const next = replaceFileMention(line, editor.col, filePath);
  const lines = [...editor.lines];
  lines[editor.row] = next.line;
  return { lines, row: editor.row, col: next.col };
}

export function footerHint(opts: { mode: AppMode; busy: boolean; queuedRecall: boolean }): string {
  if (opts.mode === "history") return "↑↓ choose · Enter fill · Esc cancel";
  if (opts.mode === "transcript") return "transcript · Esc/q back · PgUp/PgDn · Ctrl+O";
  const lead = opts.queuedRecall ? "↑ edit queued · " : "";
  const base = opts.busy ? "Enter queue · Esc stop" : "Enter send · Esc clear · Shift+Tab mode · Ctrl+O · Ctrl+R";
  return lead + base;
}

export type Stash<T> = { editor: Editor; pendingImages: T[] };

const cloneEditor = (editor: Editor): Editor => ({ lines: [...editor.lines], row: editor.row, col: editor.col });

/** Non-empty input stashes and clears. Empty input restores the previous stash. */
export function cycleStash<T>(
  stash: Stash<T> | undefined,
  editor: Editor,
  pendingImages: readonly T[],
): { stash: Stash<T> | undefined; editor: Editor; pendingImages: T[] } {
  if (!isBlank(editor) || pendingImages.length > 0) {
    return {
      stash: { editor: cloneEditor(editor), pendingImages: [...pendingImages] },
      editor: emptyEditor(),
      pendingImages: [],
    };
  }
  if (!stash) return { stash: undefined, editor, pendingImages: [...pendingImages] };
  return { stash: undefined, editor: cloneEditor(stash.editor), pendingImages: [...stash.pendingImages] };
}

export function latestTodos(
  items: readonly { kind: string; todos?: readonly { content: string; status: string }[] }[],
): readonly { content: string; status: string }[] | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "todos" && item.todos) return item.todos;
  }
  return undefined;
}

export type HistoryKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  tab?: boolean;
};

export type HistoryAction =
  | { type: "cancel" }
  | { type: "move"; index: number }
  | { type: "accept"; text: string }
  | { type: "query"; query: string }
  | { type: "ignore" };

export function historyKeyAction(
  input: string,
  key: HistoryKey,
  query: string,
  index: number,
  matches: readonly string[],
): HistoryAction {
  if (key.escape) return { type: "cancel" };
  const n = matches.length;
  if (key.upArrow) return n === 0 ? { type: "ignore" } : { type: "move", index: (index - 1 + n) % n };
  if (key.downArrow) return n === 0 ? { type: "ignore" } : { type: "move", index: (index + 1) % n };
  if (key.return && !key.meta && !key.shift) {
    const text = matches[Math.min(index, n - 1)];
    return text !== undefined ? { type: "accept", text } : { type: "ignore" };
  }
  if (key.backspace) {
    const chars = Array.from(query);
    chars.pop();
    return { type: "query", query: chars.join("") };
  }
  if (key.ctrl || key.meta || key.tab || key.return) return { type: "ignore" };
  if (input) return { type: "query", query: query + input };
  return { type: "ignore" };
}

/** Last non-empty kill replaces the yank buffer. An empty kill leaves it alone. */
export function applyKill(editor: Editor, kind: "end" | "start" | "word", yankText: string): { editor: Editor; yank: string } {
  const killed = kind === "end" ? killLineEnd(editor) : kind === "start" ? killLineStart(editor) : killWordBack(editor);
  return { editor: killed.editor, yank: killed.killed !== "" ? killed.killed : yankText };
}
