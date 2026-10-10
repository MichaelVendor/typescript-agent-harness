import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type AttachmentKind = "image" | "file";

export type AttachmentRef = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
  /** Absolute path on the host; tools can read it under cwd. */
  path: string;
};

/** Metadata without the host path — safe to put in events / session UI. */
export type AttachmentMeta = Omit<AttachmentRef, "path">;

export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 20;
export const MAX_ATTACHMENTS_PER_MESSAGE = 40;

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
  return base || "file";
}

function kindOf(mime: string): AttachmentKind {
  return IMAGE_MIMES.has(mime) ? "image" : "file";
}

export type AttachmentStore = {
  readonly root: string;
  save(input: { name: string; mime: string; data: Buffer }): AttachmentRef;
  get(id: string): AttachmentRef | undefined;
  getMany(ids: string[]): AttachmentRef[];
  readBytes(id: string): Promise<Buffer>;
};

/** Content-addressed store under `<cwd>/.tah/attachments/`. */
export function createAttachmentStore(cwd: string): AttachmentStore {
  const root = path.join(path.resolve(cwd), ".tah", "attachments");
  const objects = path.join(root, "objects");
  const metaDir = path.join(root, "meta");
  mkdirSync(objects, { recursive: true });
  mkdirSync(metaDir, { recursive: true });

  const load = (id: string): AttachmentRef | undefined => {
    const file = path.join(metaDir, `${id}.json`);
    if (!existsSync(file)) return undefined;
    const meta = JSON.parse(readFileSync(file, "utf8")) as AttachmentMeta;
    return {
      ...meta,
      path: path.join(objects, meta.sha256, safeName(meta.name)),
    };
  };

  return {
    root,
    save({ name, mime, data }) {
      const normalizedMime = mime.trim().toLowerCase() || "application/octet-stream";
      const kind = kindOf(normalizedMime);
      const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (data.length > limit) {
        throw new AttachmentError(
          `${kind} exceeds ${limit} bytes (got ${data.length}): ${name || "file"}`,
        );
      }
      if (kind === "image" && !IMAGE_MIMES.has(normalizedMime)) {
        throw new AttachmentError(`unsupported image type: ${normalizedMime}`);
      }
      const sha256 = createHash("sha256").update(data).digest("hex");
      const fileName = safeName(name);
      const objectDir = path.join(objects, sha256);
      const objectPath = path.join(objectDir, fileName);
      mkdirSync(objectDir, { recursive: true });
      if (!existsSync(objectPath)) {
        const tmp = path.join(objectDir, `.tmp-${randomBytes(8).toString("hex")}`);
        writeFileSync(tmp, data);
        renameSync(tmp, objectPath);
      }
      const id = randomBytes(12).toString("base64url");
      const meta: AttachmentMeta = {
        id,
        kind,
        name: fileName,
        mime: normalizedMime,
        bytes: data.length,
        sha256,
      };
      writeFileSync(path.join(metaDir, `${id}.json`), `${JSON.stringify(meta)}\n`);
      return { ...meta, path: objectPath };
    },
    get: load,
    getMany(ids) {
      return ids.map((id) => {
        const ref = load(id);
        if (!ref) throw new AttachmentError(`unknown attachment: ${id}`);
        return ref;
      });
    },
    async readBytes(id) {
      const ref = load(id);
      if (!ref) throw new AttachmentError(`unknown attachment: ${id}`);
      return readFile(ref.path);
    },
  };
}

export function checkMessageLimits(refs: AttachmentRef[]): void {
  if (refs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentError(`at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
  }
  const images = refs.filter((r) => r.kind === "image").length;
  if (images > MAX_IMAGES_PER_MESSAGE) {
    throw new AttachmentError(`at most ${MAX_IMAGES_PER_MESSAGE} images per message`);
  }
}
