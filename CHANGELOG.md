# Changelog

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
