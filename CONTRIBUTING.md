# Contributing

Thanks for helping typescript-agent-harness.

## Branches

- `main` — released code (tagged, e.g. `v0.14.0`)
- `v0.N` — next minor version; merge to `main` then tag `v0.N.0`

Work the next cut on `v0.15`, not on `main`.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm tah -- run --mock "列出当前目录"
npx tah --help
pnpm demo:runtime
pnpm demo:resume
pnpm demo:multi
pnpm dev
```

## Documentation site

Docs are VitePress sources under [`docs/`](./docs/).

```sh
pnpm docs:dev      # local site
pnpm docs:build    # static build → docs/.vitepress/dist
pnpm docs:preview
```

Guidelines:

- Mark pages with ✅ / 📐 / 🧭 status (see [docs/guide/status.md](./docs/guide/status.md)).
- If docs and code disagree, fix docs or code in the same PR when possible.
- Prefer editing Chinese guide pages under `docs/`; keep README EN/ZH in sync for entry points.
- Use `pnpm docs:build` before opening a docs-only PR.

GitHub Pages deploys from `main` via [`.github/workflows/docs.yml`](./.github/workflows/docs.yml).  
Enable **Settings → Pages → Source: GitHub Actions** on the repository.

## Pull requests

CI: [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) (build, typecheck, tests, mock CLI).

- Keep diffs focused; don't mix unrelated refactors.
- Don't commit secrets, local `.env`, or `*.db`.
- Don't use `--no-verify`.
