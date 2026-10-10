import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_URL = "https://github.com/MichaelVendor/typescript-agent-harness";
const SITE_URL = "https://michaelvendor.github.io/typescript-agent-harness";
const ROOT_DOCS = ["README.md", "README.zh-CN.md", "CHANGELOG.md", "CONTRIBUTING.md"];
const MAX_MATCHES = 30;
const MAX_CHARS = 40_000;

/** The repository checkout; run from `.github/docs-assistant`, or set TAH_DOCS_ROOT. */
const root = () => path.resolve(process.env.TAH_DOCS_ROOT ?? path.join(process.cwd(), "../.."));

export type DocMatch = { path: string; line: number; text: string; link: string; hits: number };

/** Repo-relative paths of everything the assistant may read: `docs/**.md` and the root docs. */
export function docPaths(): string[] {
  const docs = readdirSync(path.join(root(), "docs"), { recursive: true, encoding: "utf8" })
    .map((p) => `docs/${p.split(path.sep).join("/")}`)
    .filter((p) => p.endsWith(".md") && !p.startsWith("docs/.vitepress/") && p !== "docs/README.md");
  return [...ROOT_DOCS, ...docs.sort()];
}

/** Docs-site pages link to the site; other files to GitHub, at the line when given. */
export function linkTo(file: string, line?: number): string {
  if (file.startsWith("docs/")) {
    const page = file.slice("docs/".length).replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
    return `${SITE_URL}/${page}`;
  }
  return `${REPO_URL}/blob/main/${file}${line ? `#L${line}` : ""}`;
}

/**
 * Keyword search. The query is split on whitespace and / , ， 、 |; a line matches if it contains
 * any keyword (case-insensitive). `hits` = keywords on that line; best lines first.
 */
export function searchDocs(query: string): DocMatch[] {
  const terms = [...new Set(query.toLowerCase().split(/[\s/,，、|]+/).filter(Boolean))];
  if (terms.length === 0) return [];
  const matches: DocMatch[] = [];
  for (const file of docPaths()) {
    readFileSync(path.join(root(), file), "utf8")
      .split("\n")
      .forEach((text, i) => {
        const lower = text.toLowerCase();
        const hits = terms.filter((t) => lower.includes(t)).length;
        if (hits > 0) matches.push({ path: file, line: i + 1, text: text.trim(), link: linkTo(file, i + 1), hits });
      });
  }
  return matches.sort((a, b) => b.hits - a.hits).slice(0, MAX_MATCHES);
}

/** Only files from `docPaths()`, so a question cannot make the assistant read anything else. */
export function readDoc(file: string): { path: string; link: string; content: string; truncated: boolean } {
  const wanted = file.replace(/^\.?\//, "");
  if (!docPaths().includes(wanted)) throw new Error(`not a doc: ${file} — use a path from search_docs`);
  const content = readFileSync(path.join(root(), wanted), "utf8");
  return { path: wanted, link: linkTo(wanted), content: content.slice(0, MAX_CHARS), truncated: content.length > MAX_CHARS };
}

export type Release = { version: string; date: string; notes: string };

/** CHANGELOG sections (`## 0.26.1 — 2026-10-10`), newest first. */
export function releases(): Release[] {
  const text = readFileSync(path.join(root(), "CHANGELOG.md"), "utf8");
  return text
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading = "", ...body] = section.split("\n");
      const m = /^(\d+\.\d+\.\d+)\s*[—-]\s*(\S+)/.exec(heading);
      return m ? [{ version: m[1]!, date: m[2]!, notes: body.join("\n").trim() }] : [];
    });
}
