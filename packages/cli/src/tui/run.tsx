import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { render } from "ink";
import type { CliFlags } from "../args.js";
import { createAttachmentStore } from "../attachments/store.js";
import { createChatHost } from "../host.js";
import { renderMarkdown, useColor } from "../markdown.js";
import { App, type AppProps } from "./app.js";
import { readClipboard, type RunCommand } from "./clipboard.js";
import { imageKind, imageProtocol } from "./images.js";
import { Transcript } from "./transcript.js";

const MIME = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const;

const runCommand: RunCommand = (file, args) =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err: NodeJS.ErrnoException) =>
      resolve({ stdout: Buffer.alloc(0), code: null, ...(err.code === "ENOENT" ? { missing: true } : {}) }),
    );
    child.on("close", (code) => resolve({ stdout: Buffer.concat(chunks), code }));
  });

export async function runTui(flags: CliFlags): Promise<void> {
  const host = await createChatHost(flags);
  const color = useColor();
  const attachments = createAttachmentStore(flags.cwd);
  const transcript = new Transcript(color ? renderMarkdown : (s) => s.replace(/^\n+|\n+$/g, ""), {
    cwd: flags.cwd,
    columns: () => process.stdout.columns || 80,
    protocol: imageProtocol(process.env),
    readFile: (p) => {
      try {
        return readFileSync(p);
      } catch {
        return undefined;
      }
    },
    attachmentPath: (id) => attachments.get(id)?.path,
  });
  host.on((event) => transcript.apply(event));
  const save = (bytes: Buffer, name: string): { id: string; name: string } | { error: string } => {
    const kind = imageKind(bytes);
    if (!kind) return { error: `not an image: ${name}` };
    try {
      const ref = attachments.save({ name, mime: MIME[kind], data: bytes });
      return { id: ref.id, name: ref.name };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
  const images: NonNullable<AppProps["images"]> = {
    readClipboard: () => readClipboard(process.platform, runCommand),
    save,
    copyFile: (file) => {
      try {
        return save(readFileSync(file), path.basename(file));
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    isImageFile: (file) => {
      try {
        const fd = openSync(file, "r");
        try {
          const head = Buffer.alloc(12);
          return imageKind(head.subarray(0, readSync(fd, head, 0, 12, 0))) !== undefined;
        } finally {
          closeSync(fd);
        }
      } catch {
        return false;
      }
    },
  };
  const app = render(<App host={host} transcript={transcript} maxSteps={flags.maxSteps} color={color} images={images} />, {
    exitOnCtrlC: false,
    // A TTY was checked by the caller; CI=true would otherwise switch Ink to final-frame-only output.
    interactive: true,
    kittyKeyboard: { mode: "auto" },
  });
  try {
    await host.open();
    await app.waitUntilExit();
  } finally {
    app.unmount();
    host.cancel();
    await host.close();
  }
  if (flags.persist && !flags.quiet) {
    console.log(`[tah] session ${host.sessionId} saved — continue with: tah chat --session ${host.sessionId}`);
  }
}
