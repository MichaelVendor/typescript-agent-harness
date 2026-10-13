import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@typescript-agent-harness/tools";

/** macOS Vision framework OCR via JXA; prints one recognized line per text region. */
const SCRIPT = `
ObjC.import("Vision");
ObjC.import("Foundation");
function run(argv) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0;
  req.usesLanguageCorrection = true;
  req.recognitionLanguages = $(["zh-Hans", "en-US"]);
  if (!handler.performRequestsError($([req]), Ref())) throw new Error("NOT_IMAGE");
  const results = req.results;
  const lines = [];
  for (let i = 0; i < results.count; i++) lines.push(results.objectAtIndex(i).topCandidates(1).objectAtIndex(0).string.js);
  return lines.join("\\n");
}
`;

const TIMEOUT_MS = 30_000;

function resolveInRoot(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return resolved;
}

function ocr(file: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", SCRIPT, file],
      { timeout: TIMEOUT_MS, signal, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if (stderr.includes("NOT_IMAGE")) return reject(new Error("not a readable image"));
        if ((err as { killed?: boolean }).killed && !signal.aborted) {
          return reject(new Error(`text recognition timed out after ${TIMEOUT_MS / 1000}s`));
        }
        reject(new Error(`text recognition failed: ${stderr.trim() || err.message}`));
      },
    );
  });
}

/** Only mounted on macOS, where the Vision framework is available to `osascript`. */
export function readImageTextTool(workspaceRoot: string): Tool<{ path: string }, string> {
  return {
    name: "read_image_text",
    description:
      "Read the text in an image file (screenshot, scanned page, photo of a document) with on-device OCR; English and Chinese. Returns the recognized lines only — it cannot describe pictures. Workspace-scoped path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative image path (png, jpg, heic, …)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const file = resolveInRoot(workspaceRoot, input.path);
      if (!(await stat(file)).isFile()) throw new Error(`not a file: ${input.path}`);
      const text = (await ocr(file, ctx.signal)).trim();
      return text || "(no text found in the image)";
    },
  };
}
