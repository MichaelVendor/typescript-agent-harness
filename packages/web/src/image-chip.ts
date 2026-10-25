/** Claude Code–style positional image tags in the prompt: `[Image #N]`. */

export function imageChip(n: number): string {
  return `[Image #${n}]`;
}

/** 1-based index among image drafts for this id, or undefined if not an image slot. */
export function imageIndex(drafts: { id: string; kind: string }[], id: string): number | undefined {
  const images = drafts.filter((d) => d.kind === "image");
  const i = images.findIndex((d) => d.id === id);
  return i >= 0 ? i + 1 : undefined;
}

/** Insert `[Image #n]` at `caret`; returns new text and caret after the chip. */
export function insertImageChip(text: string, caret: number, n: number): { text: string; caret: number } {
  const chip = imageChip(n);
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const padBefore = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const padAfter = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const next = `${before}${padBefore}${chip}${padAfter}${after}`;
  return { text: next, caret: before.length + padBefore.length + chip.length };
}

/**
 * Drop `[Image #removed]` and renumber higher tags down by one.
 * Leaves surrounding whitespace tidy enough for a prompt.
 */
export function removeImageChip(text: string, removed: number): string {
  const chip = imageChip(removed);
  let out = text.split(chip).join("");
  for (let n = removed + 1; n <= 99; n++) {
    if (!out.includes(imageChip(n))) break;
    out = out.split(imageChip(n)).join(imageChip(n - 1));
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ \n/g, "\n").replace(/\n /g, "\n");
}
