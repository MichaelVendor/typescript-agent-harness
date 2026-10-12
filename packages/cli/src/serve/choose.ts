import { execFile } from "node:child_process";
import path from "node:path";

export class UnsupportedError extends Error {}

type Run = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const runFile: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8", windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });

const appleString = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;

function mac(start: string | undefined): [string, string[]] {
  const location = start ? ` default location (POSIX file ${appleString(start)})` : "";
  return ["osascript", ["-e", "tell me to activate", "-e", `POSIX path of (choose folder with prompt "Choose a folder for tah"${location})`]];
}

/** A TopMost owner keeps the dialog above the browser; UTF-8 output keeps non-ASCII paths intact. */
function windows(start: string | undefined): [string, string[]] {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = 'Choose a folder for tah'",
    "$d.ShowNewFolderButton = $true",
    ...(start ? [`$d.SelectedPath = ${psString(start)}`] : []),
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
    "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded]];
}

/**
 * Opens the system folder dialog on this machine (it has its own "New Folder" button); null when cancelled.
 * macOS and Windows only — elsewhere throws `UnsupportedError` and the page falls back to its own folder browser.
 */
export async function chooseFolder(
  start: string | undefined,
  deps: { platform?: NodeJS.Platform; run?: Run } = {},
): Promise<string | null> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32") throw new UnsupportedError("no native folder dialog on this platform");
  const [cmd, args] = platform === "darwin" ? mac(start) : windows(start);
  const { code, stdout, stderr } = await (deps.run ?? runFile)(cmd, args);
  const picked = stdout.trim();
  if (code === 0) return picked ? (platform === "win32" ? path.win32.resolve(picked) : path.resolve(picked)) : null;
  if (platform === "darwin" && stderr.includes("-128")) return null;
  throw new Error(`folder dialog failed: ${stderr.trim() || `exit ${code}`}`);
}
