import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "bundle", "tah");
const node = path.join(root, "bundle", "node", "bin", "node");

rmSync(out, { recursive: true, force: true });
// hoisted: a plain node_modules tree; pnpm's default layout is symlinks into .pnpm.
execFileSync(
  "pnpm",
  ["--filter", "@typescript-agent-harness/cli", "deploy", "--prod", "--legacy", "--config.node-linker=hoisted", out],
  { stdio: "inherit" },
);
rmSync(path.join(out, "node_modules", ".bin"), { recursive: true, force: true });

const links = execFileSync("find", [out, "-type", "l"], { encoding: "utf8" }).trim();
if (links) throw new Error(`symlinks left in bundle/tah:\n${links}`);
if (!existsSync(path.join(out, "dist", "web", "index.html"))) throw new Error("bundle/tah has no web app — run the root build first");
const want = JSON.parse(readFileSync(path.join(root, "..", "..", "packages", "cli", "package.json"), "utf8")).version;
const got = execFileSync(node, [path.join(out, "dist", "cli.js"), "--version"], { encoding: "utf8" }).trim();
if (got !== want) throw new Error(`bundled tah reports ${got}, expected ${want}`);
console.log(`tah ${got} → bundle/tah`);
