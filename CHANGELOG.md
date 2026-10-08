# Changelog

## 0.22.5 — 2026-10-08

Agent: a reopened persisted session uses the current `maxSteps` instead of the value stored when it was created (old sessions were stuck at 8 even with `--max-steps`).

Tools: `execute_command` accepts a per-call `timeoutMs` (default 30s, max 10 min), so installs and builds are no longer killed at 30s.

## 0.22.4 — 2026-10-08

CLI: assistant Markdown is rendered by `marked-terminal` (default style, syntax-highlighted code blocks), one block at a time — replacing the built-in line renderer. New dependencies: `marked@12`, `marked-terminal@7`.

## 0.22.3 — 2026-10-08

CLI: Markdown tables render as aligned box tables (CJK and emoji count as two cells; wide cells wrap to fit the terminal). Bold / italic now work when they wrap inline code (`**fix `x`**`).

## 0.22.2 — 2026-10-08

CLI: assistant Markdown is styled line by line in a terminal (headings, bold, inline code, lists, code blocks, quotes, tables); `[tah]` / `[llm]` / `[tool]` / `[ctx]` logs are dimmed. Plain text when stdout is not a TTY, `NO_COLOR` is set, or `TERM=dumb`.

CLI: approval prompts are a card — the command line, or the file path with an 8-line content preview — followed by the `y` / `a` / `n` keys.

## 0.22.1 — 2026-10-08

CLI: `tah version` / `--version` / `-v` prints the CLI version.

## 0.22.0 — 2026-10-08

Core: waterfall interceptors — `ctx.intercept(name, handler)` / `ctx.waterfall(name, payload, final)`; a handler calls `next()` to delegate or returns to short-circuit.

Tools / permissions: every tool call runs through the `tool.execute` waterfall. `--allow` / `--deny` checks moved out of `toolsPlugin` into a `permissionsPlugin` interceptor. New `approvalPlugin({ tools, ask })` asks a human before gated tools (`yes` / `no` / `always`).

CLI: `write_file` and `execute_command` ask `[y]es / [n]o / [a]lways` before running. `--yes` / `-y` skips the question. Without a TTY (piped stdin) and without `--yes`, gated calls are rejected.

Agent: `agentPlugin({ contextChars })` trims what each LLM request sees (old tool outputs first, then whole oldest turns; the latest turn is kept) and emits `agent.context.trimmed`. Full history is unchanged. `projectContext()` is exported. Reopening a persisted session replaces its stored system prompt with the current `systemPrompt`.

CLI: context budget 100,000 chars by default, `[ctx] trimmed …` line when it kicks in. `--system-file <path>` replaces the default "workspace coding agent" role (tool rules and exec hints stay); it also applies to a resumed `tah chat` session.

LLM: openai-compatible retries network errors and 408/429/5xx with backoff (`maxRetries`, default 3; honours `Retry-After`), only before the response starts streaming; emits `llm.retry`.

Agent: starting a turn fills in results for tool calls left unanswered by a cancelled or failed turn, so the next request is not rejected by the provider.

CLI: in `tah chat`, Ctrl+C cancels the running turn (including a pending approval) and returns to the prompt; Ctrl+C at an idle prompt exits. A failed turn prints `[tah] turn failed …` instead of crashing the chat. `tah run` exits on Ctrl+C again (0.22 approval reading had swallowed it). Log lines no longer stick to streamed text that did not end with a newline.

Agent: `SessionService.fork(sessionId, { turns? })` copies a session's history into a new session (optionally only the first N turns); the source is untouched; emits `session.forked`.

CLI: `tah sessions` lists saved sessions newest first (no API key needed). `tah chat --session <id|n>` continues a specific session. In chat: `/sessions`, `/resume <id|n>`, `/fork [turns]`.

## 0.21.0 — 2026-10-07

CLI defaults for local coding: `execute_command` on (`--no-exec` to disable), SQLite persist on (`--no-persist` to disable), `maxSteps=32` (`--max-steps <n>`). `tah chat` resumes the latest persisted session across `/exit`.

## 0.20.0 — 2026-10-07

CLI / agent: hitting `maxSteps` prints a readable stop message (`finishReason=max_steps`) instead of an empty failed turn. Without `--exec`, the system prompt tells the model to ask the user to restart with `tah --exec` for test/build/run.

Docs: [版本踩坑与改动](docs/guide/lessons.md) — problem / why / how by version.

## 0.19.0 — 2026-10-06

CLI: piped `tah chat` runs every stdin line then exits 0 (no `readline was closed`). No API key is an error unless `--mock`.

## 0.18.0 — 2026-10-06

Docs: global install `npm install -g @typescript-agent-harness/cli` provides the `tah` command.

## 0.17.0 — 2026-10-06

`tah --help` no longer loads `node:sqlite`. SQLite is imported only when `--persist` mounts storage.

## 0.16.0 — 2026-10-06

Docs lead with `npx @typescript-agent-harness/cli`. Clone / `pnpm build` is the from-source path.

## 0.15.0 — 2026-10-06

Packages are ready to publish to npm (`publishConfig.access: public`). CLI bin is `tah`.

- `npx @typescript-agent-harness/cli --help` after the `@typescript-agent-harness` org exists on npm
- Tag `v0.15.0` on `main` runs `.github/workflows/publish.yml` (needs `NPM_TOKEN`)

## 0.14.0 — 2026-10-06

`tah --once <ms> run <prompt>` mounts the existing scheduler and delays one session. Default CLI still has no timers. No `--every`.

## 0.13.0 — 2026-10-06

`tah --allow` / `--deny` mount the existing permissions plugin (repeatable tool names). Default CLI still has no policy.

- `--deny` wins over `--allow`; empty `--exec` gate is unchanged
- Policy also applies to MCP tools registered after boot if they are in deny/allow

## 0.12.0 — 2026-10-06

`tah --mcp <cmd>` mounts stdio MCP tools (JSON-RPC child process). Default CLI still has no MCP.

- Repeatable `--mcp-arg` for the server argv; `cwd` is the workspace
- Same default-off gate as `--exec`

## 0.11.0 — 2026-10-06

`grep` searches the workspace (regex, skips `node_modules` / `dist` / dotfiles). Default `tah` mounts it with list/read/write.

- Timeout / abort no longer hang `execute_command` (kill + drop stdio wait)

## 0.10.0 — 2026-10-06

`tah --exec` mounts `execute_command` plus an empty permissions gate. Default CLI still has no shell.

- Timeout / abort tests for `execute_command`

## 0.9.0 — 2026-10-06

`execute_command`: spawn a program with workspace cwd (not a shell). Permission deny still hides it.

- `executeCommandTool(root)` — PATH name or workspace-relative path; timeout 30s; `AbortSignal`
- Not mounted on default `tah` (same as MCP)

## 0.8.0 — 2026-10-06

Loop uses `llm.stream()`; `tah chat` / `tah run` print assistant tokens as they arrive.

- `agent.assistant-stream` + `llm.stream` events
- OpenAI-compatible provider reads SSE (`stream: true`)
- Clone the repo and `npx tah --help` after `pnpm build` (bin is `tah`)
- GitHub / Pages URLs use `typescript-agent-harness` (rename the GitHub repo to match)

## 0.7.0 — 2026-10-06

Rename: project `typescript-agent-harness`, packages `@typescript-agent-harness/*`, CLI `tah`.
Local data dir is `.tah` (old `.agent-harness` still gitignored).

## 0.6.0 — 2026-10-06

Quality floor + stdio MCP on the existing `McpBackend` seam.

- `pnpm test` — Runtime lifecycle, permission deny, unknown tool, resume after crash, stdio MCP
- GitHub Actions CI: build, typecheck, tests, mock CLI, resume demo
- Node.js ≥ 22 (`node:sqlite`)
- `stdioMcpBackend({ command, args })` — JSON-RPC + Content-Length, no vendor SDK in the kernel

## 0.5.0 — 2026-10-06

Phase 5: a CLI people can actually type into.

- `@typescript-agent-harness/cli` — `tah run` / `tah chat`
- Event trace on stdout (`--quiet` to hide)
- `--persist` for SQLite, `--mock` to skip cloud keys
- `pnpm tah -- run --mock "列出当前目录"`

## 0.4.0 — 2026-10-06

Phase 4: ecosystem plugins on the same Tool/Session seams.

- `@typescript-agent-harness/permissions` — allow/deny; denied tools are hidden from the model and fail `execute`
- `@typescript-agent-harness/mcp` — `McpBackend` adapted to `Tool` (in-process `ping`)
- `@typescript-agent-harness/scheduler` — `once` / `every` jobs that can `session.run`
- `subagentTool()` — a child Session is just another tool
- `write_file` added so permission denials have something real to block
- `examples/multi-agent` — `pnpm demo:multi`

## 0.3.0 — 2026-10-06

Phase 3: sessions survive a process restart.

- `@typescript-agent-harness/storage` — SQLite (default) + in-memory drivers; event log + checkpoints
- `session.resume()` reloads messages from disk and continues the loop
- Loop executes unfinished tool calls from the last assistant message before the next LLM request
- `examples/resume-agent` — crash after first tool, new Runtime, resume (`pnpm demo:resume`)

## 0.2.0 — 2026-10-06

Phase 2: a runnable Agent Loop on top of the Runtime.

- `@typescript-agent-harness/llm` — `llmPlugin` with `mock` and `openai-compatible` providers
- `@typescript-agent-harness/tools` — registry + `list_files` / `read_file` (workspace-scoped)
- `@typescript-agent-harness/agent` — in-memory Session, DefaultLoop, `session.run()`
- `examples/basic-agent` — mock model calls `list_files` then answers

`pnpm dev` now runs the agent demo. Runtime-only smoke: `pnpm demo:runtime`.

## 0.1.0 — 2026-10-06

Phase 1: Runtime skeleton (`Runtime` / `Plugin` / `Context` / `ServiceKey` / `EventBus`).
