import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLI_PACKAGE, isProject } from "./project.js";

const AGENTS_MD = `You are a helpful assistant for this project.

- Answer in the user's language.
- Use the tools in tools/ when they help; never invent their results.
`;

const EXAMPLE_TOOL = `import { defineTool } from "${CLI_PACKAGE}";

// File name current-time.ts → tool name current_time.
export default defineTool({
  description: "Return the current date and time (ISO 8601) and the local time zone.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return {
      now: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  },
});
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  }
}
`;

const GITIGNORE = `node_modules
.env
.tah
`;

function packageJson(cwd: string, version: string): string {
  const pkg = {
    name: path.basename(path.resolve(cwd)).toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    private: true,
    type: "module",
    devDependencies: { [CLI_PACKAGE]: `^${version}` },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** Writes the scaffold into `cwd`; existing files are left alone. Returns lines to print. */
export function initProject(cwd: string): string[] {
  const version = (
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
  ).version;
  const files: Array<[string, string]> = [
    ["package.json", packageJson(cwd, version)],
    ["AGENTS.md", AGENTS_MD],
    ["tools/current-time.ts", EXAMPLE_TOOL],
    ["tsconfig.json", TSCONFIG],
    [".env.example", "DEEPSEEK_API_KEY=\n"],
    [".gitignore", GITIGNORE],
  ];
  const lines: string[] = [];
  for (const [rel, content] of files) {
    const file = path.join(cwd, rel);
    if (existsSync(file)) {
      lines.push(`  skip    ${rel} (exists)`);
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    lines.push(`  create  ${rel}`);
  }
  if (!isProject(cwd)) {
    lines.push(
      `[tah] package.json does not depend on ${CLI_PACKAGE}; tools/ and AGENTS.md load only after: npm i -D ${CLI_PACKAGE}`,
    );
  }
  lines.push(
    "",
    "Next:",
    "  npm install",
    "  cp .env.example .env    # fill in DEEPSEEK_API_KEY, or skip and use --mock",
    "  npx tah chat",
  );
  return lines;
}
