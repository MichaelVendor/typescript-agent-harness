import { readFileSync } from "node:fs";
import { render } from "ink";
import type { CliFlags } from "../args.js";
import { createAttachmentStore } from "../attachments/store.js";
import { createChatHost } from "../host.js";
import { renderMarkdown, useColor } from "../markdown.js";
import { App } from "./app.js";
import { imageProtocol } from "./images.js";
import { Transcript } from "./transcript.js";

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
  const app = render(<App host={host} transcript={transcript} maxSteps={flags.maxSteps} color={color} />, {
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
