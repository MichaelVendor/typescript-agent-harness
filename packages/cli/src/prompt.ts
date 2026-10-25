export const DEFAULT_ROLE = "You are a workspace coding agent.";
export const PROJECT_ROLE = "You are a helpful agent. Use the available tools when they help answer the user.";

export function buildSystemPrompt(opts: {
  exec: boolean;
  mcp: boolean;
  role?: string;
  /** false: only the project's tools are mounted, so the file / command rules are left out. */
  builtinTools?: boolean;
  /** "search": web_search and web_fetch. */
  web?: "search" | "off";
  browser?: boolean;
  /** `ask_user` is mounted (someone is there to answer). */
  askUser?: boolean;
  skillsCatalog?: string;
}): string {
  const role = opts.role?.trim();
  if (opts.builtinTools === false) {
    let systemPrompt = role || PROJECT_ROLE;
    if (opts.mcp) {
      systemPrompt += "\n\nMCP tools from --mcp are also available.";
    }
    if (opts.web && opts.web !== "off") systemPrompt += `\n\n${WEB_RULES[opts.web]}`;
    if (opts.browser) systemPrompt += `\n\n${BROWSER_RULES}`;
    if (opts.askUser) systemPrompt += `\n\n${ASK_USER_RULES}`;
    return appendSkillsCatalog(systemPrompt, opts.skillsCatalog);
  }
  const rules =
    "Prefer list_files, read_file, and grep before answering. Change files only when asked: edit_file for changes to an existing file, write_file for new files or full rewrites. For tasks with 3 or more steps, keep a task list with todo_write and update it as you go. When the user asks to draw, generate, or show a picture, write an SVG with write_file and put that path in the reply — the chat displays png, jpeg, webp, gif, and svg paths — instead of asking which format. Answer in the user's language.";
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
  if (opts.web && opts.web !== "off") systemPrompt += ` ${WEB_RULES[opts.web]}`;
  if (opts.browser) systemPrompt += ` ${BROWSER_RULES}`;
  if (opts.askUser) systemPrompt += ` ${ASK_USER_RULES}`;
  systemPrompt += `\n\n${ABOUT_TAH}`;
  return appendSkillsCatalog(systemPrompt, opts.skillsCatalog);
}

const WEB_RULES = {
  search:
    "Use web_search for current or external information (docs, versions, news) and web_fetch to read a page; cite the URLs you rely on.",
};

const BROWSER_RULES =
  "For pages that need clicking, forms, logins, or JavaScript rendering, call browser_open first: it opens a Chrome browser the user can watch and adds browser_* tools. Understand pages with browser_snapshot or browser_find; screenshots are only saved for the user. For logins, captchas, payments, or anything that needs the user's confirmation, stop and ask the user to finish it in that browser.";

const ASK_USER_RULES =
  "When a request is ambiguous or has several reasonable approaches, ask with ask_user (short questions, 2–5 concrete options, the recommended one first) before doing the work instead of guessing or asking in plain text; when the request is clear, just do it.";

/** Without this the model guesses it runs in Cursor or Claude Code and gives their instructions. */
export const ABOUT_TAH = [
  "You run inside tah (typescript-agent-harness), not Cursor or Claude Code.",
  "Skills are folders with a SKILL.md whose YAML frontmatter has `name` (kebab-case, the same as the folder name) and `description` (when to use it).",
  "tah loads skills from `skills/`, `.agents/skills/` and `.cursor/skills/` in the working folder, and from `~/.tah/skills/` for every folder; a new or changed skill is available from the next message.",
  "To install a skill here, write `skills/<name>/SKILL.md` with write_file, or tell the user to run `tah skill add owner/repo` (GitHub) / a git URL. The web app Settings → Skills can import a local folder or install from Git the same way.",
].join(" ");

function appendSkillsCatalog(systemPrompt: string, skillsCatalog?: string): string {
  if (!skillsCatalog) return systemPrompt;
  return `${systemPrompt}\n\n${skillsCatalog}`;
}
