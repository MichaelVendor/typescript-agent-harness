# Image that runs `tah agent-host` for the control plane.
#
# Build from the repo root (do not run in tests/CI):
#   docker build -f apps/control/Dockerfile -t tah-agent-host .
#
# The control plane does not publish ports. It starts this image as
# `tah-project-<id>` with:
#   tah agent-host --cwd /workspace --host 0.0.0.0 --port 7800 --project-id <id> --yes
# and reaches it at docker inspect IP:7800.

FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @typescript-agent-harness/cli... build \
 && chmod +x /src/packages/cli/dist/cli.js \
 && ln -sf /src/packages/cli/dist/cli.js /usr/local/bin/tah
WORKDIR /workspace
CMD ["tah", "agent-host", "--cwd", "/workspace", "--host", "0.0.0.0", "--port", "7800"]
