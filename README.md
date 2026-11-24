# typescript-agent-harness

English | [中文](./README.zh-CN.md)

**Docs:** https://MichaelVendor.github.io/typescript-agent-harness/ · local: `pnpm docs:dev`

TypeScript **Agent Runtime / SDK** — build your own agent by convention.

> **Everything is a capability.**

## Build an agent (start here)

No startup code: `AGENTS.md` is the role, each file in `tools/` is a tool, each `skills/*/SKILL.md` is a skill.

```sh
mkdir my-agent && cd my-agent
npx @typescript-agent-harness/cli init
npx tah --mock chat
```

Then: edit `AGENTS.md` → add `tools/*.ts` (`defineTool`) → optional `skills/*/SKILL.md` → keep chatting (`/` invokes skills).

**One-hour checklist:** init works · tool hot-reloads on save · `/hello` (or your skill) works · mock round proves “this is my agent”.

Full guide: [Getting started](./docs/guide/getting-started.md) · [CLI · convention projects](./docs/guide/cli.md)

## Embed the Runtime

Plugins talk only through Context (advanced):

```ts
const runtime = new Runtime();
runtime.use(llmPlugin({ provider: "mock" }));
runtime.use(toolsPlugin({ tools: [listFilesTool(process.cwd())] }));
runtime.use(agentPlugin());
await runtime.start();
const session = await runtime.get(SESSION).create();
await session.run("列出当前目录并总结");
```

See [Philosophy](./docs/guide/philosophy.md) · [Architecture](./docs/guide/architecture.md) · [API](./docs/api/core.md)

## Advanced hosts (optional)

Local TUI/web, desktop, headless host, intranet control plane, Super-agent / IM — not required to build an agent:

- `tah chat` / `tah serve` — [CLI](./docs/guide/cli.md)
- Index: [Hosts](./docs/guide/hosts.md)

## Install / from source

```sh
npx @typescript-agent-harness/cli --help
npx @typescript-agent-harness/cli run --mock "列出当前目录并说明这个项目"
```

Install globally to get the `tah` command:

```sh
npm install -g @typescript-agent-harness/cli
tah --help
tah run --mock "列出当前目录并说明这个项目"
```

If `tah` is not found, add `$(npm prefix -g)/bin` to `PATH`. Do not use `sudo npm`.

Node.js ≥ 22.

From the repo (demos and docs):

```sh
pnpm install
pnpm build
pnpm tah -- run --mock "列出当前目录并说明这个项目"
pnpm tah -- --mock chat
```

`pnpm dev` runs [`examples/basic-agent`](examples/basic-agent). DeepSeek: copy [`examples/basic-agent/.env.example`](examples/basic-agent/.env.example) to `.env` in that folder.

Other demos: `pnpm demo:runtime` · `pnpm demo:resume` · `pnpm demo:multi` · `pnpm demo:convention`

**Expert examples (try locally on branch `v1.7`):** clone → `git checkout v1.7` → `pnpm install && pnpm build` → pick one of:

- [`examples/meeting-actions-agent`](examples/meeting-actions-agent) — meeting notes → actions (`pnpm start` / `tah serve`)
- [`examples/weekly-report-agent`](examples/weekly-report-agent) — weekly notes → report
- [`examples/resume-jd-agent`](examples/resume-jd-agent) — resume × JD

Fixtures live under each `data/fixtures/`. Steps: [Getting started · expert examples](./docs/guide/getting-started.md).

### Documentation site

```sh
pnpm docs:dev      # VitePress → http://localhost:5173
pnpm docs:build
pnpm docs:preview
```

Pushing to `main` deploys docs via GitHub Actions → GitHub Pages. Enable **Settings → Pages → Source: GitHub Actions** once. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Layout

```
packages/
  core/     Runtime / Plugin / Context / Service / EventBus
  llm/      mock + OpenAI-compatible
  tools/    registry + list/read/write/exec + permission gate
  agent/    Session + DefaultLoop + resume + subagent tool
  storage/  SQLite event log + checkpoints
  cli/      tah run / tah chat (TUI) / tah serve / tah init + project loader
  web/      tah serve page (React + Vite, shipped inside cli)
examples/
  convention-agent/       AGENTS.md + tools/ + plugins/
  basic-agent/             tool-use loop demo
  meeting-actions-agent/   meeting notes → actions
  weekly-report-agent/     weekly notes → report
  resume-jd-agent/         resume × JD
```

Full package and example list: [Ecosystem](./docs/guide/ecosystem.md).

Phase history and plans: [Roadmap](./docs/guide/roadmap.md)

## Documentation

- **Site:** https://MichaelVendor.github.io/typescript-agent-harness/
- **Source:** [`docs/`](./docs/) (VitePress, Chinese)

Start here: [Getting started](./docs/guide/getting-started.md) · [CLI](./docs/guide/cli.md) · [Philosophy](./docs/guide/philosophy.md) · [Architecture](./docs/guide/architecture.md)
