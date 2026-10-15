import type { HostEvent } from "@typescript-agent-harness/cli";

/** A file the preview panel can open: a path in the open folder, or an uploaded attachment. */
export type FileTarget = { path: string } | { attachment: string; name?: string };

export function fileQuery(target: FileTarget): string {
  return "attachment" in target
    ? `attachment=${encodeURIComponent(target.attachment)}`
    : `path=${encodeURIComponent(target.path)}`;
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|pdf|mp4|webm|mov|html?|md|markdown|mdx|tsx?|jsx?|mjs|cjs|json|jsonc|css|scss|less|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|ya?ml|toml|ini|conf|txt|log|csv|tsv|xml|sql|vue|svelte|lock)$/i;

/** `src/a.ts:12` / `src/a.ts:12:5` → `src/a.ts`. */
const withoutLine = (p: string) => p.replace(/(:\d+){1,2}$/, "");

/** Inline code that names a file: no spaces, brackets or quotes, not a URL, and has a `/` or a known extension. */
export function codePath(code: string): string | null {
  const text = withoutLine(code.trim());
  if (!text || /[\s()[\]{}<>"'`,;]/.test(text) || SCHEME.test(text)) return null;
  return text.includes("/") || EXT.test(text) ? text : null;
}

/** A Markdown link target that names a file; web, mail, `file:` and `#` links do not. */
export function linkPath(href: string | undefined): string | null {
  if (!href || href.startsWith("#") || href.startsWith("//")) return null;
  let file = withoutLine(href.replace(/[?#].*$/, ""));
  if (SCHEME.test(file)) return null;
  try {
    file = decodeURI(file);
  } catch {}
  return file || null;
}

/** `src` inside the previewed file `file` (folder-relative), as a folder-relative path; null for web / data / anchors or above the folder. */
export function relativeTo(file: string, src: string): string | null {
  if (!src || src.startsWith("#") || src.startsWith("//") || SCHEME.test(src)) return null;
  let clean = src.replace(/[?#].*$/, "");
  try {
    clean = decodeURI(clean);
  } catch {}
  if (clean.startsWith("/")) return clean;
  const parts = file.split("/").slice(0, -1);
  for (const seg of clean.split("/")) {
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg && seg !== ".") {
      parts.push(seg);
    }
  }
  return parts.join("/") || null;
}

/** A fenced block for highlighting `text`, fenced longer than any backtick run in it. */
export function codeBlock(text: string, file: string): string {
  let longest = 2;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  const dot = file.lastIndexOf(".");
  const lang = dot > file.lastIndexOf("/") ? file.slice(dot + 1).toLowerCase() : "";
  return `${fence}${/^[a-z\d]+$/.test(lang) ? lang : ""}\n${text}\n${fence}`;
}

const WRITERS = new Set(["write_file", "edit_file", "execute_command"]);

/** A finished tool that may have changed files: the open preview checks its file again. */
export function touchesFiles(event: HostEvent): boolean {
  return event.type === "tool.end" && WRITERS.has(event.tool);
}
