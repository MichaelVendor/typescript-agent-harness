import { inflateSync } from "node:zlib";
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
  // Files are compared by realpath, so the workspace root must be too (macOS /var and /tmp are symlinks).
  let root = cwd;
  try {
    root = io.realpath(cwd);
  } catch {
    // keep the raw cwd
  }

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
    if (!insideWorkspace(real, root)) continue;
    if (io.size(real) > MAX_IMAGE_BYTES) continue;
    if (!imageKind(io.head(real))) continue;
    if (seen.has(real)) continue;

    seen.add(real);
    result.push(real);
  }

  return result;
}

export type ImageProtocol = "kitty" | "iterm" | "sixel" | "none";

export function imageProtocol(env: NodeJS.ProcessEnv): ImageProtocol {
  if (
    env.KITTY_WINDOW_ID ||
    env.TERM_PROGRAM === "ghostty" ||
    env.TERM === "xterm-kitty" ||
    env.WEZTERM_EXECUTABLE ||
    env.TERM_PROGRAM === "WezTerm"
  ) {
    return "kitty";
  }
  if (env.TERM_PROGRAM === "vscode" || env.TERM_PROGRAM === "iTerm.app") return "iterm";
  if (env.WT_SESSION || env.TERM === "foot") return "sixel";
  return "none";
}

// Kitty `rowcolumn-diacritics`, indexed by row or column number.
const DIACRITICS = [
  "0305", "030D", "030E", "0310", "0312", "033D", "033E", "033F", "0346", "034A", "034B", "034C",
  "0350", "0351", "0352", "0357", "035B", "0363", "0364", "0365", "0366", "0367", "0368", "0369",
  "036A", "036B", "036C", "036D", "036E", "036F", "0483", "0484", "0485", "0486", "0487", "0592",
  "0593", "0594", "0595", "0597", "0598", "0599", "059C", "059D", "059E", "059F", "05A0", "05A1",
  "05A8", "05A9", "05AB", "05AC", "05AF", "05C4", "0610", "0611", "0612", "0613", "0614", "0615",
  "0616", "0617", "0657", "0658", "0659", "065A", "065B", "065D", "065E", "06D6", "06D7", "06D8",
  "06D9", "06DA", "06DB", "06DC", "06DF", "06E0", "06E1", "06E2", "06E4", "06E7", "06E8", "06EB",
  "06EC", "0730", "0732", "0733", "0735", "0736", "073A", "073D", "073F", "0740", "0741", "0743",
  "0745", "0747", "0749", "074A", "07EB", "07EC", "07ED", "07EE", "07EF", "07F0", "07F1", "07F3",
  "0816", "0817", "0818", "0819", "081B", "081C", "081D", "081E", "081F", "0820", "0821", "0822",
  "0823", "0825", "0826", "0827", "0829", "082A", "082B", "082C", "082D", "0951", "0953", "0954",
  "0F82", "0F83", "0F86", "0F87", "135D", "135E", "135F", "17DD", "193A", "1A17", "1A75", "1A76",
  "1A77", "1A78", "1A79", "1A7A", "1A7B", "1A7C", "1B6B", "1B6D", "1B6E", "1B6F", "1B70", "1B71",
  "1B72", "1B73", "1CD0", "1CD1", "1CD2", "1CDA", "1CDB", "1CE0", "1DC0", "1DC1", "1DC3", "1DC4",
  "1DC5", "1DC6", "1DC7", "1DC8", "1DC9", "1DCB", "1DCC", "1DD1", "1DD2", "1DD3", "1DD4", "1DD5",
  "1DD6", "1DD7", "1DD8", "1DD9", "1DDA", "1DDB", "1DDC", "1DDD", "1DDE", "1DDF", "1DE0", "1DE1",
  "1DE2", "1DE3", "1DE4", "1DE5", "1DE6", "1DFE", "20D0", "20D1", "20D4", "20D5", "20D6", "20D7",
  "20DB", "20DC", "20E1", "20E7", "20E9", "20F0", "2CEF", "2CF0", "2CF1", "2DE0", "2DE1", "2DE2",
  "2DE3", "2DE4", "2DE5", "2DE6", "2DE7", "2DE8", "2DE9", "2DEA", "2DEB", "2DEC", "2DED", "2DEE",
  "2DEF", "2DF0", "2DF1", "2DF2", "2DF3", "2DF4", "2DF5", "2DF6", "2DF7", "2DF8", "2DF9", "2DFA",
  "2DFB", "2DFC", "2DFD", "2DFE", "2DFF", "A66F", "A67C", "A67D", "A6F0", "A6F1", "A8E0", "A8E1",
  "A8E2", "A8E3", "A8E4", "A8E5", "A8E6", "A8E7", "A8E8", "A8E9", "A8EA", "A8EB", "A8EC", "A8ED",
  "A8EE", "A8EF", "A8F0", "A8F1", "AAB0", "AAB2", "AAB3", "AAB7", "AAB8", "AABE", "AABF", "AAC1",
  "FE20", "FE21", "FE22", "FE23", "FE24", "FE25", "FE26", "10A0F", "10A38", "1D185", "1D186",
  "1D187", "1D188", "1D189", "1D1AA", "1D1AB", "1D1AC", "1D1AD", "1D242", "1D243", "1D244",
].map((hex) => String.fromCodePoint(parseInt(hex, 16)));

let nextImageId = 1;

function cellSize(kind: ImageKind, bytes: Buffer, columns: number): { cols: number; rows: number } {
  let pxW = 0;
  let pxH = 0;
  if (kind === "png" && bytes.length >= 24) {
    pxW = bytes.readUInt32BE(16);
    pxH = bytes.readUInt32BE(20);
  } else if (kind === "gif" && bytes.length >= 10) {
    pxW = bytes.readUInt16LE(6);
    pxH = bytes.readUInt16LE(8);
  }
  if (pxW > 0 && pxH > 0) return fitCells(pxW, pxH, columns);
  return { cols: Math.max(1, Math.min(40, columns)), rows: 12 };
}

function encodeKitty(bytes: Buffer, wantCols: number, wantRows: number): string {
  const cols = Math.min(wantCols, DIACRITICS.length);
  const rows = Math.min(wantRows, DIACRITICS.length);
  const id = nextImageId;
  nextImageId = (nextImageId % 255) + 1;
  const transmit = `\x1b_Ga=T,f=100,t=d,q=2,U=1,i=${id},c=${cols},r=${rows};${bytes.toString("base64")}\x1b\\`;
  const color = `\x1b[38;5;${id}m`;
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = color;
    for (let col = 0; col < cols; col++) {
      line += "\u{10EEEE}" + DIACRITICS[row] + DIACRITICS[col];
    }
    lines.push(line + "\x1b[39m");
  }
  return transmit + lines.join("\n");
}

function encodeIterm(bytes: Buffer, cols: number, rows: number): string {
  const name = Buffer.from("image").toString("base64");
  const seq = `\x1b]1337;File=name=${name};inline=1;width=${cols};height=${rows};preserveAspectRatio=1:${bytes.toString("base64")}\x07`;
  return seq + "\n".repeat(rows);
}

type Rgba = { width: number; height: number; data: Buffer };

function decodePng(bytes: Buffer): Rgba | undefined {
  try {
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat: Buffer[] = [];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const body = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === "IHDR") {
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        const depth = body[8];
        const colorType = body[9];
        const interlace = body[12];
        if (depth !== 8 || interlace !== 0) return undefined;
        if (colorType === 2) channels = 3;
        else if (colorType === 6) channels = 4;
        else return undefined;
      } else if (type === "IDAT") {
        idat.push(body);
      } else if (type === "IEND") {
        break;
      }
      offset += 12 + length;
    }
    if (!width || !height || !channels || idat.length === 0) return undefined;

    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length !== height * (stride + 1)) return undefined;

    const out = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!;
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? out[dst + i - channels]! : 0;
        const up = y > 0 ? out[dst - stride + i]! : 0;
        const upLeft = y > 0 && i >= channels ? out[dst - stride + i - channels]! : 0;
        let predictor: number;
        if (filter === 0) predictor = 0;
        else if (filter === 1) predictor = left;
        else if (filter === 2) predictor = up;
        else if (filter === 3) predictor = (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        } else return undefined;
        out[dst + i] = (raw[src + i]! + predictor) & 0xff;
      }
    }

    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = out[i * channels]!;
      data[i * 4 + 1] = out[i * channels + 1]!;
      data[i * 4 + 2] = out[i * channels + 2]!;
      data[i * 4 + 3] = channels === 4 ? out[i * channels + 3]! : 255;
    }
    return { width, height, data };
  } catch {
    return undefined;
  }
}

function encodeSixel(bytes: Buffer, cols: number, rows: number): string {
  const image = decodePng(bytes);
  if (!image) return "";

  // Nearest-neighbour scale to cols x rows pixels.
  const pixels = new Int16Array(cols * rows);
  const used = new Set<number>();
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / rows));
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / cols));
      const o = (sy * image.width + sx) * 4;
      const index = ((image.data[o]! >> 6) << 4) | ((image.data[o + 1]! >> 6) << 2) | (image.data[o + 2]! >> 6);
      pixels[y * cols + x] = index;
      used.add(index);
    }
  }

  let out = "\x1bPq";
  for (const index of used) {
    const r = Math.round((((index >> 4) & 3) * 0x40 * 100) / 255);
    const g = Math.round((((index >> 2) & 3) * 0x40 * 100) / 255);
    const b = Math.round(((index & 3) * 0x40 * 100) / 255);
    out += `#${index};2;${r};${g};${b}`;
  }
  for (let top = 0; top < rows; top += 6) {
    const band = new Set<number>();
    for (let y = top; y < Math.min(rows, top + 6); y++) {
      for (let x = 0; x < cols; x++) {
        band.add(pixels[y * cols + x]!);
      }
    }
    let first = true;
    for (const index of band) {
      if (!first) out += "$";
      first = false;
      out += `#${index}`;
      for (let x = 0; x < cols; x++) {
        let bits = 0;
        for (let k = 0; k < 6 && top + k < rows; k++) {
          if (pixels[(top + k) * cols + x] === index) bits |= 1 << k;
        }
        out += String.fromCharCode(63 + bits);
      }
    }
    out += "-";
  }
  return out + "\x1b\\" + "\n".repeat(rows);
}

export function encodeImage(input: {
  protocol: ImageProtocol;
  bytes: Buffer;
  columns: number;
}): string {
  const { protocol, bytes, columns } = input;
  if (protocol === "none" || bytes.length > MAX_IMAGE_BYTES) return "";
  const kind = imageKind(bytes);
  if (!kind) return "";
  const { cols, rows } = cellSize(kind, bytes, columns);
  if (protocol === "iterm") return encodeIterm(bytes, cols, rows);
  if (kind !== "png") return "";
  if (protocol === "kitty") return encodeKitty(bytes, cols, rows);
  return encodeSixel(bytes, cols, rows);
}
