import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { FileKind } from "./protocol.js";

/** Outside the open folder, missing, a directory or unreadable: callers answer all of them as 404. */
export class NotInFolderError extends Error {
  constructor() {
    super("not found in this folder");
  }
}

/** `file` (relative to `folder`, or absolute) as a real file inside the real `folder`; symlinks may not lead out. */
export async function resolveInFolder(
  folder: string,
  file: string,
): Promise<{ abs: string; rel: string; bytes: number; mtime: number }> {
  try {
    const root = await realpath(folder);
    const abs = await realpath(path.resolve(root, file));
    if (!abs.startsWith(root + path.sep)) throw new NotInFolderError();
    const info = await stat(abs);
    if (!info.isFile()) throw new NotInFolderError();
    return { abs, rel: path.relative(root, abs).split(path.sep).join("/"), bytes: info.size, mtime: Math.floor(info.mtimeMs) };
  } catch {
    throw new NotInFolderError();
  }
}

const KINDS: Record<string, FileKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  bmp: "image",
  pdf: "pdf",
  mp4: "video",
  webm: "video",
  mov: "video",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
};

const ext = (file: string) => path.extname(file).slice(1).toLowerCase();

/** By extension; anything else is text unless its first 8KB has a NUL byte. */
export async function fileKind(abs: string): Promise<FileKind> {
  const known = KINDS[ext(abs)];
  if (known) return known;
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0) ? "binary" : "text";
  } finally {
    await handle.close();
  }
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
};

export function contentType(abs: string, kind: FileKind): string {
  return TYPES[ext(abs)] ?? (kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream");
}

/** One `bytes=` range of a `size`-byte file: undefined = no header, null = malformed or out of bounds. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (header === undefined) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? null : { start, end };
}

/** Streams `abs` with `headers` plus nosniff / no-cache; honours one `Range`. */
export function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  abs: string,
  size: number,
  headers: Record<string, string>,
): void {
  const range = parseRange(req.headers.range, size);
  if (range === null) {
    res.writeHead(416, { "content-range": `bytes */${size}` }).end();
    return;
  }
  const common = {
    ...headers,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "no-cache",
  };
  if (range) {
    res.writeHead(206, {
      ...common,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
    });
  } else {
    res.writeHead(200, { ...common, "content-length": String(size) });
  }
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(abs, range ?? {});
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
