# Build stage — full monorepo so workspace deps (@agenticos/vault-core,
# which ships as raw TypeScript) resolve. esbuild bundles server.ts plus
# ALL its imports (fastify + vault-core's TS) into one self-contained
# dist/server.cjs. The runtime stage then needs zero node_modules — which
# sidesteps both the pnpm-symlinked-node_modules copy problem AND the
# "vault-core is raw .ts, node can't import it" problem in one move.
FROM node:22-slim AS build

WORKDIR /repo

# pnpm via corepack (built into Node 22)
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Manifests first for layer-cache efficiency
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/vault-core/package.json packages/vault-core/
COPY infra/vault-server/package.json infra/vault-server/

# Install just what vault-server needs (+ its workspace deps)
RUN pnpm install --frozen-lockfile --filter @agenticos/vault-server...

# Sources
COPY packages/vault-core packages/vault-core
COPY infra/vault-server infra/vault-server

# Bundle to a single self-contained CJS file
RUN pnpm --filter @agenticos/vault-server build

# Runtime stage — just Node + the one bundled file. No node_modules.
FROM node:22-slim AS runtime

WORKDIR /app

COPY --from=build /repo/infra/vault-server/dist/server.cjs ./server.cjs

# Non-root user
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=7777
EXPOSE 7777

CMD ["node", "server.cjs"]
