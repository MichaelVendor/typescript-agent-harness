export const DEFAULT_MAX_STEPS = 32;

export type CliFlags = {
  command: string;
  prompt: string;
  cwd: string;
  mock: boolean;
  persist: boolean;
  quiet: boolean;
  exec: boolean;
  yes: boolean;
  systemFile: string;
  session: string;
  mcpCommand: string;
  mcpArgs: string[];
  allow: string[];
  deny: string[];
  onceMs: number;
  maxSteps: number;
};

export function parseArgv(argv: string[]): CliFlags {
  const flags: CliFlags = {
    command: "help",
    prompt: "",
    cwd: process.cwd(),
    mock: false,
    persist: true,
    quiet: false,
    exec: true,
    yes: false,
    systemFile: "",
    session: "",
    mcpCommand: "",
    mcpArgs: [],
    allow: [],
    deny: [],
    onceMs: -1,
    maxSteps: DEFAULT_MAX_STEPS,
  };
  const rest: string[] = [];
  let help = false;
  let version = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--" || arg === undefined) continue;
    if (arg === "--mock") flags.mock = true;
    else if (arg === "--persist") flags.persist = true;
    else if (arg === "--no-persist") flags.persist = false;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--exec") flags.exec = true;
    else if (arg === "--no-exec") flags.exec = false;
    else if (arg === "--yes" || arg === "-y") flags.yes = true;
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
    } else if (arg === "--max-steps") {
      const next = argv[i + 1];
      if (!next) throw new Error("--max-steps requires a positive integer");
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("--max-steps requires a positive integer");
      }
      flags.maxSteps = n;
      i += 1;
    } else if (arg === "--system-file") {
      const next = argv[i + 1];
      if (!next) throw new Error("--system-file requires a path");
      flags.systemFile = next;
      i += 1;
    } else if (arg === "--session") {
      const next = argv[i + 1];
      if (!next) throw new Error("--session requires a session id or number");
      flags.session = next;
      i += 1;
    } else if (arg === "--cwd") {
      const next = argv[i + 1];
      if (!next) throw new Error("--cwd requires a path");
      flags.cwd = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (!arg.startsWith("-")) {
      rest.push(arg);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (help || version) {
    flags.command = help ? "help" : "version";
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
  tah chat             continue last session if persisted
                       /exit /reset /sessions /resume <id|n> /fork [turns]
  tah sessions         list saved sessions (newest first; numbers work with --session)
  tah help
  tah version          print the CLI version (also --version, -v)

Flags:
  --cwd <path>        workspace root (default: process.cwd())
  --mock              local fake LLM (required if no DEEPSEEK_API_KEY / OPENAI_API_KEY)
  --persist           SQLite at <cwd>/.tah/cli.db (on by default)
  --no-persist        disable SQLite; chat will not resume across exits
  --quiet             only print assistant text
  --exec              mount execute_command (on by default)
  --no-exec           disable execute_command
  --yes, -y           skip approval for write_file / execute_command (asked by default; rejected if stdin is not a TTY)
  --max-steps <n>     LLM round limit per turn (default: ${DEFAULT_MAX_STEPS})
  --system-file <p>   replace the default "workspace coding agent" role with this file's text
  --session <id|n>    tah chat: continue this session instead of the latest
  --mcp <cmd>         mount stdio MCP tools from a child process (off by default)
  --mcp-arg <a>       extra argv for --mcp (repeatable)
  --allow <tool>      allowlist (repeatable; omit = all tools allowed)
  --deny <tool>       denylist (repeatable; wins over --allow)
  --once <ms>         delay then run once via scheduler (off by default; tah run only)
`;
}
