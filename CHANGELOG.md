# Changelog

## Unreleased

Web (`tah serve`): browser panel fixes — tab names show the page's title (and follow title changes) instead of the host and port; the page gets the last mouse position when you stop moving, so hover menus open where the pointer is; the scroll wheel scrolls only the page, not the panel; a failed click or keystroke shows its error under the address bar.

## 0.36.0 — 2026-10-14

Web (`tah serve`): **browser panel** — the built-in browser now shows in a panel on the right instead of a separate Chrome window: watch the agent click and type, or take over yourself (click, scroll, type — including Chinese input methods — e.g. to log in or solve a captcha). It opens when the agent calls `browser_open`, when you click an http(s) link in the conversation (⌘ / Ctrl-click still opens a new tab), from **Open in browser** on an HTML file preview, or from **Browser** in the status bar (type a URL). The panel shares the right side with the file preview (File / Browser switch). When a page shows an alert, confirm or prompt, a bar under the address bar shows its text with OK / Cancel (and an answer box for a prompt). Opening the browser yourself does not give the agent its browser tools: its first `browser_open` still asks. The panel cannot open tah's own address (except file previews), so the agent's browser never gets the tah sign-in; what you type goes only to Chrome. `tah serve` runs Chrome headless (Playwright MCP launches it with a random debugging port on 127.0.0.1, `--idle-timeout 0`, a 1280×720 viewport); `tah chat` still shows a window. New endpoints `GET /api/browser`, `GET /api/browser/stream` and `POST /api/browser/{open,nav,tab,input,dialog,close}`.

## 0.35.0 — 2026-10-14

Desktop: **macOS app** (`apps/desktop`, Apple Silicon, built locally with `pnpm --filter desktop dist` → `apps/desktop/release/tah-<version>-arm64.dmg`, unsigned). It wraps `tah serve` in a window: double-click to open, reopens the last folder (first launch asks for one), and agent commands get the PATH from your login shell. It ships its own Node 22 and shares `~/.tah` with the command line. Closing the window keeps tah running; ⌘Q stops it. No changes to the published packages.

Web (`tah serve`): **file preview** — file paths in the conversation open in a panel on the right: paths in file-tool lines (`read_file`, `write_file`, `edit_file`, `read_image_text`), attachment chips, Markdown links and inline code that look like paths. Images, PDF and video play in place; HTML renders with its relative CSS / JS / images and can load from the web, but runs sandboxed as an opaque origin (no sign-in cookie, no access to the tah API) — only preview HTML you trust; Markdown renders like replies; code is highlighted. The panel only reads files inside the open folder, is read-only, and reloads when a write, edit or command changes the file. Drag its edge to resize. New endpoints `GET /api/files/stat`, `GET /api/files/raw` (supports `Range`) and `GET /preview/<token>/<path>`; host `tool.start` / `tool.end` events and history tool items carry `path` for file tools.

## 0.33.0 — 2026-10-13

Images: each saved model has a **"can read images"** setting (Settings → Models: "Can read images" when adding, an "Images" checkbox on each model; the composer's model menu tags them "images"). Image attachments go to a model as pictures only when it is marked; the `.env` model still follows `--vision` / `TAH_VISION=1` / `capabilities.vision`. When the model in use can't read images, images already in the conversation are sent as `[image omitted]` text, so switching from a vision model to a text-only one no longer breaks the request. New endpoint `POST /api/settings/models/vision` `{ id, vision }`; `POST /api/settings/models` accepts `vision`; `GET /api/settings` models carry `vision`. LLM package: `images: false` option.

Tools: **`read_image_text`** (macOS only) reads the text in an image — screenshots, scanned pages — with the system's on-device OCR (Vision framework, English and Chinese). It is mounted with the built-in coding tools, needs no approval, is limited to the workspace, and times out after 30 seconds. It returns the recognized lines, "(no text found in the image)", or "not a readable image"; it does not describe pictures. The attachment note tells a model that can't read images to use it. Not available on Windows or Linux.

## 0.32.0 — 2026-10-13

Web (`tah serve`): the sidebar is laid out like DeepSeek Harness — a tah header with a collapse button, a full-width **New session** row, and search / view options / add folder next to "Workspaces". **Search** finds sessions by title or folder name across folders and highlights the match. **View options** switch between grouping by folder and **One list** (every folder's sessions, newest first). Each folder shows its first 5 sessions, with "Show N more" for the rest (the current session always stays visible); hovering a folder shows `+` (new session there) and `⋯` (remove from list). The current session shows a spinner while a turn runs and an orange dot with "needs approval" while waiting for you. The collapse button shrinks the sidebar to a 56px icon rail (expand, new session, search, add folder, settings). Fork moved to the session right-click menu. The collapsed state and grouping are remembered in the browser.

Web (`tah serve`): **model picker** in the composer, like DeepSeek Harness — the composer is now a card with the text on top and a toolbar below: `+` (attach) on the left, the model button and a round send button (stop while a turn runs) on the right. The model button shows the model in use; its menu lists saved models grouped by provider (DeepSeek, OpenAI, or the host for other endpoints), plus "From .env" when `.env` has a key, and "Manage models…" opens Settings. Picking one is the same as **Use** in Settings: every session uses it from the next turn; the button is disabled while a turn runs. The model name moved out of the status bar. `GET /api/settings` adds `env` (`{ model, key }` with the variable name, never the key itself, or `null`).

## 0.31.0 — 2026-10-13

Tools: **`edit_file`** replaces exact text in an existing file instead of rewriting it — `old_string` must match exactly once (the error says how many times it matched), or set `replace_all`. It needs approval like `write_file`; the terminal and web approval cards preview the change as `-` old / `+` new lines. The default prompt now steers the model to `edit_file` for changes and `write_file` for new files.

Tools: **`todo_write`** keeps a task list for multi-step work — the model sends the whole list each time (`pending` / `in_progress` / `completed`), and the prompt asks for it on tasks with 3 or more steps. No approval needed. The web app shows it above the composer as a collapsible "Tasks 2/5" panel (hidden once everything is done); the terminal UI prints the list in the conversation, and `--plain` / `tah run` print `[x]` / `[>]` / `[ ]` lines. The list is read back from the session messages, so it survives a page reload or a resumed session. New host event `todos`; `session` events carry `todos` when the session has a list.

Tools: **`web_fetch`** and **`web_search`** — the agent can read web pages and search the web. `web_fetch` needs no key: it only fetches public http(s) addresses (loopback, private and link-local addresses are refused, re-checked on every redirect), with a 20-second timeout and a 2 MB cap, and turns HTML into text with headings, lists and links (30k characters by default). `web_search` uses Tavily and is mounted once a key is set in the web app (Settings → **Web search**, saved in `~/.tah/settings.json`, never sent back to the page) or as `TAVILY_API_KEY` in `.env`. Both are on wherever the built-in coding tools are; `tah.config.json` `"capabilities": { "web": false }` turns them off (`"web": true` no longer fails at startup). The startup line shows `web=on` or `web=fetch` (no search key). New endpoint `POST /api/settings/search`; `GET /api/settings` adds `search`.

Tools: **built-in browser** — the agent can click, type, fill forms and log in on real pages through a bundled [Playwright MCP](https://github.com/microsoft/playwright-mcp) (`@playwright/mcp` 0.0.83) driving the local Chrome. Only a small `browser_open` tool is offered at first; once the user approves it, Chrome starts and 18 `browser_*` tools are mounted (navigate, snapshot, find, click, type, fill_form, take_screenshot, close, …); `browser_close` withdraws them again. Opening asks once — while the browser is open, `browser_open` goes through without asking; `browser_file_upload` asks every time. `tah serve` and `tah chat` show the Chrome window, `tah run` runs headless. Logins persist in `~/.tah/browser-profile` (shared by all folders; if another tah holds it, `browser_open` says so). Results over 30k characters are cut, screenshots are saved under `.tah/browser/` and not sent to the model. On wherever `web` is; `"capabilities": { "browser": false }` turns it off, `--mock` never starts it. The startup line shows `browser=on`.

MCP: the stdio client now speaks the standard one-JSON-message-per-line framing (it used `Content-Length` headers, so real MCP servers never answered); tool results are turned into text, with images replaced by `[image omitted]` and `isError` results reported as tool errors.

Context: **compaction** — when a request would go over the context budget, the earlier turns are first summarized by the model into one message, and later requests send that summary (inside the system prompt) instead of the old turns; trimming is now the fallback when summarizing fails. Compact any time with `/compact` (terminal UI and `--plain`) or **Compact** in the web status bar (`POST /api/compact`); it runs as a turn, so Stop / Ctrl+C cancels it. Full history is kept: the summary is a marked system message in the session, saved with it, so resumed and forked sessions keep it. Agent package: `session.compact()`, `applySummary`, `compactHistory`, events `agent.context.compacted` / `agent.context.compact-failed`.

## 0.30.1 — 2026-10-12

CLI: the agent is told it runs inside tah and how Skills work (where they live, how to install one with `write_file`), so it no longer answers "install a skill" with Cursor instructions. Plain folders (not tah projects) now load `skills/`, `.agents/skills/` and `.cursor/skills/` too, and only those folders are watched for reloads there.

Web (`tah serve`): Settings → **Skills** lists the skills the open folder loads and imports skill folders with the system dialog — one skill, or every skill inside a folder such as `~/.cursor/skills` — into `~/.tah/skills` (symlinks copied as files; invalid or already-installed names are skipped). Imported skills can be removed there. New endpoints: `GET /api/skills`, `POST /api/skills/import`, `POST /api/skills/remove`.

## 0.30.0 — 2026-10-12

Web (`tah serve`): **work folders** — the sidebar groups sessions by folder (Pinned stays on top, across folders); a Cursor-style "Workspaces" header with a folder button offers "Open project…" (recently removed folders first, or browse) and "New folder…" (created on the Desktop by default, location changeable, then opened); opening a session in another folder makes it the agent's working directory (one current session at a time). The folder list lives in `~/.tah/workspaces.json`. New endpoints: `GET /api/workspaces`, `GET /api/workspaces/recent`, `POST /api/workspaces/add|remove`, `GET /api/fs`, `POST /api/fs/mkdir`; `reset` / `resume` / `fork` / `rename` / `session-flag` accept an optional `cwd`. Design: `docs/design/workspaces`. Picking a folder ("Choose folder…", "Change…") opens the system folder dialog on macOS and Windows (`POST /api/fs/choose`); elsewhere the in-page browser is used. Folder groups use icon buttons and indent their sessions.

Web (`tah serve`): **Settings** — the bottom of the sidebar shows the computer user name with a gear button that opens Settings, where you add LLM models (name, API key, optional base URL; `deepseek*` defaults to the DeepSeek URL, anything else to OpenAI) and pick the active one. Models live in `~/.tah/settings.json` (mode 0600); the active model takes priority over `.env` for `tah serve`, `tah chat`, and `tah run`. Keys are never sent back to the page (only a hint like `sk-…abcd`). Switching models reloads the current folder and keeps the session. `tah serve` now starts without any key and reports "no model configured" when you send. New endpoints: `GET /api/settings`, `POST /api/settings/models`, `POST /api/settings/models/remove`, `POST /api/settings/active`.

Web (`tah serve`): consecutive tool calls (and the `[ctx] trimmed` notices between them) fold into one block — while running it shows "Working N steps" with per-tool counts and only the latest three steps; once the turn moves on it collapses to one summary line ("Ran N steps · read_file ×18 · grep ×5 · 1 failed") that expands on click.

## 0.29.1 — 2026-10-12

Web (`tah serve`): Cursor-style session sidebar — a Pinned section, one-line rows with relative times (`now` / `5m` / `21h` / `2d`), pin and archive buttons that replace the time on hover, and a right-click menu (Pin / Rename / Fork / Copy ID / Archive). Pinned and archived ids live in `.tah/session-flags.json` (new `POST /api/session-flag`); archived sessions are hidden from the web list only — `tah sessions` and `/sessions` still show them.

## 0.29.0 — 2026-10-12

CLI: **Skills** — discover local `SKILL.md` packages (and flat `.md`) under `skills/`, `.agents/skills/`, `.cursor/skills/`, and `~/.tah/skills/`; merge by priority when names collide. Model-invocable skills appear as a catalog in the system prompt; load full instructions via the built-in `skill` tool or user `/kebab-name` in `tah chat` / `tah serve`. Hot reload covers the same skill directories. Reserved tool name `skill`. Design: `docs/design/skills`. `tah init` scaffolds `skills/hello/SKILL.md`.

## 0.28.3 — 2026-10-11

Republish: `0.28.2` left `@typescript-agent-harness/llm` stuck in npm staging (installable CLI depended on a missing `llm@0.28.2`). Same features as 0.28.2.

## 0.28.2 — 2026-10-11

Web (`tah serve`): empty sessions show a short New chat placeholder in the main pane instead of a blank transcript. **Broken on npm** — `llm@0.28.2` never left staging; use `0.28.3+`.

## 0.28.1 — 2026-10-11

CLI / Web (`tah serve`): session list titles for attachment-only turns use file names instead of `(attachments)`. Reconnecting no longer clears the transcript before the session replay (blank main pane). Sessions can be renamed from the sidebar (double-click or ✎); titles live in `<cwd>/.tah/session-titles.json` via `POST /api/rename`.

## 0.28.0 — 2026-10-10

CLI: convention projects may include a root `tah.config.json` for official capability packs (`capabilities.coding` / `web` / `vision`) and `extensions.mcp`. Merge order is built-in defaults → config → CLI / env. Unknown keys fail at startup. `capabilities.web: true` is rejected until web tools ship. `tah init` writes an example config (`coding: true` so builtins stay on next to `tools/`). Design: `docs/design/config.md`.

## 0.27.0 — 2026-10-10

CLI / Web: `tah serve` accepts file and image attachments (pick, drag, or paste). Bytes are stored content-addressed under `<cwd>/.tah/attachments/`; the session keeps only metadata. By default the user message includes read-only host paths so tools can inspect them (including when the model is text-only). Pass `--vision` or set `TAH_VISION=1` to project images into OpenAI-compatible multimodal parts. Limits: images PNG/JPEG/WebP/GIF ≤ 20 MiB (≤ 20 per message), other files ≤ 32 MiB, ≤ 40 attachments per message.

LLM: `user` messages may use `ContentPart[]` (`text` / `image_url`).

## 0.26.3 — 2026-10-10

LLM: with only `OPENAI_API_KEY` set, the OpenAI-compatible provider now uses `https://api.openai.com/v1`; it used to fail at startup with a stack trace unless `OPENAI_BASE_URL` was set too.

CLI: a blank `KEY=` line in `.env` now counts as unset, so the empty `DEEPSEEK_API_KEY=` from `.env.example` no longer hides `OPENAI_API_KEY` (tah reported "no key"). `tah init`'s `.env.example` also lists the `OPENAI_*` variables for other providers.

Docs: the tutorial shows `.env` examples and the OpenAI-compatible base URLs of the common providers.

## 0.26.2 — 2026-10-10

CLI: `tah run --quiet` prints only the final reply, once the run ends, with no blank-line padding. Text the model wrote before its tool calls (“Let me check the docs…”) used to stream into stdout ahead of the answer.

Repo: new issues get an automatic reply from a tah convention project in `.github/docs-assistant/` that answers from the docs in the checkout (workflow `docs-assistant.yml`, needs the `DEEPSEEK_API_KEY` secret).

## 0.26.1 — 2026-10-10

Web: the message box and the Send / Stop button are now the same height on one line (the button sat 6px lower), and a growing message box accounts for its border instead of overflowing by 2px. With several lines the button stays at the bottom.

## 0.26.0 — 2026-10-10

CLI: terminal `tah chat` and `tah serve` reload a convention project when `AGENTS.md` or a file under `tools/`, `plugins/` or `lib/` changes. The runtime is rebuilt and the current session reopened by id, so history is kept and a new `AGENTS.md` applies from the next turn; a change during a turn waits for the turn to end, and commands sent during a reload wait for it. If the new files fail to load or a plugin's setup throws, the previous version keeps running and a `[tah] reload failed — …` notice says why; saving again retries. "Always allow" answers survive a reload. With `--no-persist` it only says to restart; `--no-watch` turns it off. Project files now load with jiti's module cache off, so edited helpers are picked up too.

CLI: `notice` events gain an optional `error` flag; reload failures set it and show as errors in the TUI and in red on the web page.

Core: a `Runtime.start` that fails now disposes the plugins already set up, in reverse order, so open files and child processes are not leaked.

Web: the session sidebar now refreshes after every turn, including one that starts and ends within a single frame.

## 0.25.0 — 2026-10-10

CLI: `tah serve` runs a local web workbench for the agent in the current directory and opens the browser: streamed Markdown, tool lines, approval cards (allow once / always / reject), step-limit continue, a session sidebar (switch / new / fork), stop, and a status bar — parity with the TUI. One current session; every open tab shows it and stays in sync, and a reloaded or reconnected tab rebuilds from the server. It listens on `127.0.0.1` only (default port 7420, `--port <n>`, `--no-open`); the printed link carries a one-time token that the page exchanges for an HttpOnly cookie, and `Host` / `Origin` are checked on every request. The other `tah chat` flags apply as before.

CLI: `ChatHost` gains `user` and `approval.end` events and `snapshot()`, and the protocol types (`HostEvent`, `SessionEvent`, `ServeRequest`, …) are exported from the package. The TUI now shows the user's message and clears answered approvals from these events.

Web: new private package `packages/web` (React + Vite), built into `packages/cli/dist/web` and shipped with the CLI. It depends only on the CLI's protocol types; Markdown is rendered without raw HTML.

## 0.24.2 — 2026-10-10

CLI: the TUI's terminal cursor now sits in the input box. It used to lag one render behind, ending up below the status bar after a reply and one keystroke behind while typing.

## 0.24.1 — 2026-10-10

CLI: fix a TUI crash ("Maximum update depth exceeded") while streaming long replies. The transcript now notifies the UI at most once per event-loop tick instead of on every text delta.

## 0.24.0 — 2026-10-09

CLI: terminal `tah chat` opens an Ink TUI (inline scrollback, streamed Markdown, tool lines, in-UI approval, slash-command menu, session picker, multiline input with paste). Piped / non-TTY input and `--plain` keep the previous line mode. New `ChatHost` session interface (`packages/cli/src/host.ts`) turns runtime events into plain-JSON `HostEvent`s for the TUI and for a future `tah serve`. Dependencies: `ink@8`, `react@19`, `string-width@8`.

## 0.23.1 — 2026-10-09

CLI: `tah init` installs dependencies after scaffolding, with the package manager from the lockfile in the directory, else the one that launched it (`pnpm dlx` → pnpm), else npm. Inside another pnpm workspace it runs `pnpm install --ignore-workspace`, since plain `pnpm install` installs the outer workspace and skips the project. `--no-install` skips the step; when it is skipped or fails, the printed next steps include the command to run.

CLI: a project file importing a package that is not installed (e.g. running `tah chat` before installing) now says `tah: tools/x.ts imports "<package>", which is not installed in <dir> — run: <install command>` instead of a Node require stack.

## 0.23.0 — 2026-10-09

CLI: convention-based projects. In a directory whose `package.json` depends on `@typescript-agent-harness/cli`, `tah run` / `tah chat` load `AGENTS.md` (replaces the default role; `--system-file` still wins), every top-level file in `tools/` (`export default defineTool({...})`; `query-order.ts` → tool `query_order`) and in `plugins/` (`export default definePlugin({...})`, registered after the built-ins as `project:<file>`). TypeScript files load through `jiti`, no build step. With a `tools/` directory the built-in file / command tools and their prompt rules are left out; `--builtin-tools` brings them back. Load errors, bad exports, invalid or duplicate tool names stop startup with the file path. Directories without the dependency behave exactly as before.

CLI: `tah init` scaffolds `package.json`, `AGENTS.md`, `tools/current-time.ts`, `tsconfig.json`, `.env.example` and `.gitignore`, skipping files that already exist.

CLI: the package now has a library entry — `defineTool`, `definePlugin` and the `Tool` / `ToolContext` / `Plugin` / `Context` types; `main` points at it instead of the CLI script. New dependency: `jiti@2`.

## 0.22.7 — 2026-10-09

CLI: no more `ExperimentalWarning: SQLite is an experimental feature…` on startup; other Node warnings still print.

## 0.22.6 — 2026-10-09

CLI: no step limit per turn by default (was 32), matching Claude Code / Cursor — a turn runs until the model stops; Ctrl+C interrupts. With `--max-steps <n>`, a chat turn that hits the limit asks `Step limit reached … Enter continue · n stop`; Enter resumes the same turn with a fresh budget. The status line's `steps` now counts this turn's LLM rounds (it was the session total), and the max_steps hint points at continuing or `--max-steps` instead of the SDK-facing text.

Agent: default `maxSteps` raised from 8 to 20 (in line with the Vercel AI SDK); pass `Infinity` for no limit.

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
