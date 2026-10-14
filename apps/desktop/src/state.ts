import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const file = (home: string) => path.join(home, ".tah", "desktop.json");

/** The folder the app had open last time, if it still exists. */
export function readLastFolder(home: string): string | undefined {
  let folder: unknown;
  try {
    folder = (JSON.parse(readFileSync(file(home), "utf8")) as { lastFolder?: unknown }).lastFolder;
  } catch {
    return undefined;
  }
  if (typeof folder !== "string" || !existsSync(folder) || !statSync(folder).isDirectory()) return undefined;
  return folder;
}

export function writeLastFolder(home: string, folder: string): void {
  mkdirSync(path.dirname(file(home)), { recursive: true });
  writeFileSync(file(home), `${JSON.stringify({ lastFolder: folder }, null, 2)}\n`);
}
