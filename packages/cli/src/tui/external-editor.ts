import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type EditorRunner = (cmd: string, args: string[]) => Promise<{ code: number | null }>;

const defaultRun: EditorRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code }));
  });

export async function editInEditor(
  initial: string,
  opts: {
    env?: NodeJS.ProcessEnv;
    run?: EditorRunner;
    writeFile?: (path: string, data: string) => Promise<void>;
    readFile?: (path: string) => Promise<string>;
    mkdtemp?: (prefix: string) => Promise<string>;
  } = {},
): Promise<{ text: string } | { error: "editor unavailable" | "editor failed" }> {
  const cmd =
    opts.env?.VISUAL ||
    opts.env?.EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR;
  if (!cmd) return { error: "editor unavailable" };

  const mk = opts.mkdtemp ?? ((prefix: string) => mkdtemp(path.join(tmpdir(), prefix)));
  const write = opts.writeFile ?? ((p, data) => writeFile(p, data, "utf8"));
  const read = opts.readFile ?? ((p) => readFile(p, "utf8"));

  const dir = await mk("tah-prompt-");
  const tempPath = path.join(dir, `${path.basename(dir)}.txt`);

  try {
    await write(tempPath, initial);
    const run = opts.run ?? defaultRun;
    const { code } = await run(cmd, [tempPath]);
    if (code !== 0) return { error: "editor failed" };
    const text = await read(tempPath);
    return { text };
  } catch {
    return { error: "editor failed" };
  }
}
