export type CliFlags = {
  command: string;
  prompt: string;
  cwd: string;
  mock: boolean;
  persist: boolean;
  quiet: boolean;
  exec: boolean;
  mcpCommand: string;
  mcpArgs: string[];
  allow: string[];
  deny: string[];
  onceMs: number;
};

export function parseArgv(argv: string[]): CliFlags {
  const flags: CliFlags = {
    command: "help",
    prompt: "",
    cwd: process.cwd(),
    mock: false,
    persist: false,
    quiet: false,
    exec: false,
    mcpCommand: "",
    mcpArgs: [],
    allow: [],
    deny: [],
    onceMs: -1,
  };
  const rest: string[] = [];
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--" || arg === undefined) continue;
    if (arg === "--mock") flags.mock = true;
    else if (arg === "--persist") flags.persist = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--exec") flags.exec = true;
    else if (arg === "--mcp") {
      const next = argv[i + 1];
      if (!next) throw new Error("--mcp requires a command");
      flags.mcpCommand = next;
      i += 1;
    } else if (arg === "--mcp-arg") {
      const next = argv[i + 1];
      if (!next) throw new Error("--mcp-arg requires a value");
      flags.mcpArgs.push(next);
      i += 1;
    } else if (arg === "--allow") {
      const next = argv[i + 1];
      if (!next) throw new Error("--allow requires a tool name");
      flags.allow.push(next);
      i += 1;
    } else if (arg === "--deny") {
      const next = argv[i + 1];
      if (!next) throw new Error("--deny requires a tool name");
      flags.deny.push(next);
      i += 1;
    } else if (arg === "--once") {
      const next = argv[i + 1];
      if (!next) throw new Error("--once requires a non-negative integer (ms)");
      const ms = Number(next);
      if (!Number.isInteger(ms) || ms < 0) {
        throw new Error("--once requires a non-negative integer (ms)");
      }
      flags.onceMs = ms;
      i += 1;
    } else if (arg === "--cwd") {
      const next = argv[i + 1];
      if (!next) throw new Error("--cwd requires a path");
      flags.cwd = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (!arg.startsWith("-")) {
      rest.push(arg);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (help) {
    flags.command = "help";
    flags.prompt = "";
    return flags;
  }
  flags.command = rest[0] ?? "help";
  flags.prompt = rest.slice(1).join(" ");
  return flags;
}

export function usage(): string {
  return `typescript-agent-harness CLI

Usage:
  tah run <prompt>     one-shot session
  tah chat             session; stdin lines until EOF or /exit (/reset new session)
  tah help

Flags:
  --cwd <path>   workspace root (default: process.cwd())
  --mock         local fake LLM (required if no DEEPSEEK_API_KEY / OPENAI_API_KEY)
  --persist      SQLite at <cwd>/.tah/cli.db
  --quiet        only print assistant text
  --exec         mount execute_command (needed to test/build/run programs; off by default)
  --mcp <cmd>    mount stdio MCP tools from a child process (off by default)
  --mcp-arg <a>  extra argv for --mcp (repeatable)
  --allow <tool> allowlist (repeatable; omit = all tools allowed)
  --deny <tool>  denylist (repeatable; wins over --allow)
  --once <ms>    delay then run once via scheduler (off by default; tah run only)
`;
}
