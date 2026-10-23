import { imageKind } from "./images.ts";

export type CommandResult = { stdout: Buffer; code: number | null; missing?: boolean };
export type RunCommand = (file: string, args: string[]) => Promise<CommandResult>;

const NO_IMAGE = "clipboard has no image";
const UNAVAILABLE = "image clipboard unavailable";

const MAC_CLIPBOARD_SCRIPT = [
  'ObjC.import("AppKit");',
  "var pb=$.NSPasteboard.generalPasteboard;",
  "var img=$.NSImage.alloc.initWithPasteboard(pb);",
  "if(img.isNil())$.exit(1);",
  "var tiff=img.TIFFRepresentation;",
  "var rep=$.NSBitmapImageRep.imageRepWithData(tiff);",
  "var png=rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$());",
  "if(!png||png.length===0)$.exit(1);",
  "print(ObjC.unwrap(png.base64EncodedStringWithOptions(0)));",
].join("");

const WIN_CLIPBOARD_COMMAND = [
  "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
  "$i=[System.Windows.Forms.Clipboard]::GetImage();",
  "if($null -eq $i){exit 1};",
  "$m=New-Object System.IO.MemoryStream;",
  "$i.Save($m,[System.Drawing.Imaging.ImageFormat]::Png);",
  "[Console]::OpenStandardOutput().Write($m.ToArray(),0,$m.Length)",
].join(" ");

function imageFromResult(stdout: Buffer, code: number | null): { bytes?: Buffer; error?: string } {
  if (code !== 0 || stdout.length === 0) {
    return { error: NO_IMAGE };
  }
  if (!imageKind(stdout)) {
    return { error: NO_IMAGE };
  }
  return { bytes: stdout };
}

export function pastedImagePaths(
  text: string,
  isImageFile: (path: string) => boolean,
): string[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const words = trimmed.split(/\s+/);
  if (!words.every(isImageFile)) return undefined;
  return words;
}

async function readDarwin(run: RunCommand): Promise<{ bytes?: Buffer; error?: string }> {
  const result = await run("osascript", ["-l", "JavaScript", "-e", MAC_CLIPBOARD_SCRIPT]);
  if (result.code !== 0 || result.stdout.length === 0) {
    return { error: NO_IMAGE };
  }
  const bytes = Buffer.from(result.stdout.toString().trim(), "base64");
  return imageFromResult(bytes, 0);
}

async function readLinux(run: RunCommand): Promise<{ bytes?: Buffer; error?: string }> {
  const wl = await run("wl-paste", ["--type", "image/png"]);
  if (wl.missing) {
    const xc = await run("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (xc.missing) {
      return { error: UNAVAILABLE };
    }
    if (xc.stdout.length === 0 || !imageKind(xc.stdout)) {
      return { error: NO_IMAGE };
    }
    return { bytes: xc.stdout };
  }
  if (wl.stdout.length === 0 || !imageKind(wl.stdout)) {
    return { error: NO_IMAGE };
  }
  return { bytes: wl.stdout };
}

async function readWin32(run: RunCommand): Promise<{ bytes?: Buffer; error?: string }> {
  const result = await run("powershell.exe", ["-NoProfile", "-Command", WIN_CLIPBOARD_COMMAND]);
  return imageFromResult(result.stdout, result.code);
}

export async function readClipboard(
  platform: NodeJS.Platform,
  run: RunCommand,
): Promise<{ bytes?: Buffer; error?: string }> {
  if (platform === "darwin") return readDarwin(run);
  if (platform === "linux") return readLinux(run);
  if (platform === "win32") return readWin32(run);
  return { error: UNAVAILABLE };
}
