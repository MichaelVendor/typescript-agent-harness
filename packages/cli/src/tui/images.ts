import path from "node:path";

export type ImageKind = "png" | "jpeg" | "gif" | "webp";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PATHS = 20;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function imageKind(head: Buffer): ImageKind | undefined {
  if (
    head.length >= 4 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return "png";
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "jpeg";
  }
  if (head.length >= 6) {
    const sig = head.subarray(0, 6).toString("ascii");
    if (sig === "GIF87a" || sig === "GIF89a") return "gif";
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return undefined;
}

export function fitCells(
  pxW: number,
  pxH: number,
  columns: number,
): { cols: number; rows: number } {
  let rows = Math.min(20, Math.max(1, pxH));
  const idealCols = Math.max(1, Math.round((rows * pxW) / pxH));
  const maxCols = Math.max(1, columns);
  let cols = Math.min(maxCols, idealCols);
  if (cols < idealCols) {
    rows = Math.min(20, Math.max(1, Math.round((cols * pxH) / pxW)));
  }
  return { cols, rows };
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function isRemoteOrSpecial(raw: string): boolean {
  return (
    raw.startsWith("http:") ||
    raw.startsWith("https:") ||
    raw.startsWith("data:") ||
    raw.startsWith("//")
  );
}

function insideWorkspace(real: string, cwd: string): boolean {
  const root = path.resolve(cwd);
  const abs = path.resolve(real);
  return abs === root || abs.startsWith(root + path.sep);
}

function extensionOk(raw: string): boolean {
  const ext = path.extname(raw).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function collectCandidates(text: string): string[] {
  const plain = stripAnsi(text);
  const out: string[] = [];
  const md = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of plain.matchAll(md)) {
    out.push(match[1]!);
  }
  for (const word of plain.split(/\s+/)) {
    if (word) out.push(word);
  }
  return out;
}

export function imagePaths(
  text: string,
  cwd: string,
  io: {
    realpath(p: string): string;
    size(p: string): number;
    head(p: string): Buffer;
  },
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of collectCandidates(text)) {
    if (result.length >= MAX_IMAGE_PATHS) break;
    if (isRemoteOrSpecial(raw)) continue;
    if (!extensionOk(raw)) continue;

    const resolved = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    let real: string;
    try {
      real = io.realpath(resolved);
    } catch {
      continue;
    }
    if (!insideWorkspace(real, cwd)) continue;
    if (io.size(real) > MAX_IMAGE_BYTES) continue;
    if (!imageKind(io.head(real))) continue;
    if (seen.has(real)) continue;

    seen.add(real);
    result.push(real);
  }

  return result;
}
