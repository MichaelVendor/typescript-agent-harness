import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).config.node;
const name = `node-v${version}-darwin-arm64`;
const base = `https://nodejs.org/dist/v${version}`;
const out = path.join(root, "bundle", "node");
const stamp = path.join(root, "bundle", "node.version");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version && existsSync(path.join(out, "bin", "node"))) {
  console.log(`node ${version} already in bundle/node`);
  process.exit(0);
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sums = (await get(`${base}/SHASUMS256.txt`)).toString("utf8");
const expected = sums
  .split("\n")
  .find((line) => line.endsWith(`  ${name}.tar.gz`))
  ?.split(" ")[0];
if (!expected) throw new Error(`${name}.tar.gz is not listed in SHASUMS256.txt`);
const tarball = await get(`${base}/${name}.tar.gz`);
const actual = createHash("sha256").update(tarball).digest("hex");
if (actual !== expected) throw new Error(`checksum mismatch for ${name}.tar.gz: got ${actual}, want ${expected}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "bin"), { recursive: true });
const archive = path.join(root, "bundle", `${name}.tar.gz`);
writeFileSync(archive, tarball);
execFileSync("tar", ["-xzf", archive, "-C", path.join(out, "bin"), "--strip-components=2", `${name}/bin/node`]);
rmSync(archive);
writeFileSync(stamp, version);
console.log(`node ${version} → bundle/node/bin/node`);
