# Credential broker image. Unlike gh-token-broker (a mounted script on node:22-slim
# with zero deps), this service needs @1password/sdk to resolve op:// refs with the
# service-account token, so it installs deps at build time.
FROM node:22-slim

WORKDIR /app

# Install prod deps first for layer caching. No lockfile is committed yet (scaffold);
# switch to `npm ci` once package-lock.json lands.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# Non-root — the broker holds the backing token; drop privileges.
USER node

ENV PORT=9100
EXPOSE 9100

CMD ["node", "src/main.mjs"]
