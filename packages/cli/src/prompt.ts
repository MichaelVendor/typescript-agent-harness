export const DEFAULT_ROLE = "You are a workspace coding agent.";
export const PROJECT_ROLE = "You are a helpful agent. Use the available tools when they help answer the user.";

export function buildSystemPrompt(opts: {
  exec: boolean;
  mcp: boolean;
  role?: string;
  /** false: only the project's tools are mounted, so the file / command rules are left out. */
  builtinTools?: boolean;
}): string {
  const role = opts.role?.trim();
  if (opts.builtinTools === false) {
    let systemPrompt = role || PROJECT_ROLE;
    if (opts.mcp) {
      systemPrompt += "\n\nMCP tools from --mcp are also available.";
    }
    return systemPrompt;
  }
  const rules =
    "Prefer list_files, read_file, and grep before answering. Use write_file only when asked to change files.";
  let systemPrompt = role ? `${role}\n\n${rules}` : `${DEFAULT_ROLE} ${rules}`;
  if (opts.exec) {
    systemPrompt +=
      " Use execute_command only when asked to run a program or tests.";
  } else {
    systemPrompt +=
      " You cannot run programs or tests (execute_command is off). If the user asks to test, build, install, or run a command, tell them to restart without --no-exec.";
  }
  if (opts.mcp) {
    systemPrompt += " MCP tools from --mcp are also available.";
  }
  return systemPrompt;
}
