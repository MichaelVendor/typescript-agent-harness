export type SlashCommand = { name: string; args?: string; description: string };

export const COMMANDS: SlashCommand[] = [
  { name: "/resume", args: "[id|n]", description: "switch session (no argument: pick from a list)" },
  { name: "/sessions", description: "pick a saved session" },
  { name: "/fork", args: "[turns]", description: "copy this session (optionally the first n turns) and switch to it" },
  { name: "/compact", description: "summarize the conversation so far to free up context" },
  { name: "/reset", description: "start a new session" },
  { name: "/exit", description: "quit" },
];

/**
 * Built-ins first; then extras (user-invocable skills, slashable MCP prompts) as `/name`.
 * Skips extras that collide with a built-in or an earlier extra.
 */
export function matchCommands(
  query: string,
  extras: { name: string; description: string }[] = [],
): SlashCommand[] {
  const taken = new Set(COMMANDS.map((c) => c.name));
  const fromExtras: SlashCommand[] = [];
  for (const item of extras) {
    const name = item.name.startsWith("/") ? item.name : `/${item.name}`;
    if (taken.has(name)) continue;
    taken.add(name);
    fromExtras.push({ name, description: item.description });
  }
  return [...COMMANDS, ...fromExtras].filter((c) => c.name.startsWith(query));
}

export type ParsedCommand =
  | { kind: "exit" }
  | { kind: "reset" }
  | { kind: "compact" }
  | { kind: "pick" }
  | { kind: "resume"; ref: string }
  | { kind: "fork"; turns?: number }
  | { kind: "error"; message: string };

/** `undefined`: not a known command, send the line as a message. */
export function parseCommand(line: string): ParsedCommand | undefined {
  const [name, arg, extra] = line.trim().split(/\s+/);
  switch (name) {
    case "/exit":
    case "/quit":
      return { kind: "exit" };
    case "/reset":
      return { kind: "reset" };
    case "/compact":
      return { kind: "compact" };
    case "/sessions":
      return { kind: "pick" };
    case "/resume":
      return arg ? { kind: "resume", ref: arg } : { kind: "pick" };
    case "/fork":
      if (arg === undefined) return { kind: "fork" };
      if (!/^\d+$/.test(arg) || extra !== undefined) return { kind: "error", message: "usage: /fork [turns]" };
      return { kind: "fork", turns: Number(arg) };
    default:
      return undefined;
  }
}
