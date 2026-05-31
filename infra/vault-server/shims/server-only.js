// esbuild alias target for the `server-only` package.
//
// `@agenticos/vault-core`'s InMemoryVaultStore carries `import "server-only"`
// to guarantee it never gets pulled into a browser/Client-Component bundle in
// the Next.js dashboard. The real `server-only` package's default export is a
// bare `throw new Error(...)` — it only no-ops under the `react-server` export
// condition, which esbuild's `--platform=node` build does NOT set. vault-server
// is a plain Fastify process, not a React Server Component context, so bundling
// the real module would inline that throw and crash the server on startup.
//
// We alias `server-only` to this empty module in the esbuild build (see the
// `build` script in package.json). vault-server runs exclusively server-side,
// so the guard the real package provides is irrelevant here — an empty no-op is
// exactly the correct behavior.
//
// NOTE: this lives in `shims/`, NOT `build/`, on purpose — the repo-root
// .dockerignore excludes `**/build`, which would strip this file from the
// Docker build context and break the alias inside the image.
export {};
