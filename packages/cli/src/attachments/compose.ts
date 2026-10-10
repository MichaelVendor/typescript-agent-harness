import type { ContentPart } from "@typescript-agent-harness/llm";
import type { AttachmentMeta, AttachmentRef } from "./store.js";

const MARKER = "[tah-attachments]:";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Path handles for the model (and a machine-readable line for history rebuild). */
export function composeAttachmentPrompt(text: string, refs: AttachmentRef[]): string {
  const body = text.trimEnd();
  if (refs.length === 0) return body;
  const meta: AttachmentMeta[] = refs.map(({ id, kind, name, mime, bytes, sha256 }) => ({
    id,
    kind,
    name,
    mime,
    bytes,
    sha256,
  }));
  const lines = refs.map((r) => {
    const base = `- ${r.kind} ${r.name} → ${r.path} (${r.mime}, ${formatSize(r.bytes)})`;
    return r.kind === "image"
      ? `${base}. Use tools to inspect; this model may not see pixels unless vision is enabled.`
      : base;
  });
  const parts = [
    body,
    `${MARKER} ${JSON.stringify(meta)}`,
    "[attachments]",
    ...lines,
  ].filter((p, i) => i === 0 || p.length > 0);
  return parts.join("\n\n");
}

/** Display text and attachment cards from a stored user message. */
export function parseUserContent(content: string): { text: string; attachments: AttachmentMeta[] } {
  const idx = content.indexOf(`\n\n${MARKER} `);
  const atStart = content.startsWith(`${MARKER} `);
  if (idx < 0 && !atStart) return { text: content, attachments: [] };
  const cut = atStart ? 0 : idx;
  const text = content.slice(0, cut).trimEnd();
  const rest = content.slice(atStart ? 0 : idx + 2);
  const lineEnd = rest.indexOf("\n");
  const line = lineEnd < 0 ? rest : rest.slice(0, lineEnd);
  const json = line.slice(MARKER.length).trim();
  try {
    const attachments = JSON.parse(json) as AttachmentMeta[];
    return { text, attachments: Array.isArray(attachments) ? attachments : [] };
  } catch {
    return { text: content, attachments: [] };
  }
}

export function userContentForVision(
  text: string,
  refs: AttachmentRef[],
  images: Array<{ mime: string; data: Buffer }>,
): ContentPart[] {
  const prompt = composeAttachmentPrompt(text, refs);
  const parts: ContentPart[] = [{ type: "text", text: prompt || "(attachments only)" }];
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.data.toString("base64")}` },
    });
  }
  return parts;
}
