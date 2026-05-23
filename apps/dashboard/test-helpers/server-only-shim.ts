// Test-only shim for the `server-only` package.
//
// The real `server-only` package's default entry throws an Error whenever
// imported — Next.js works around this by resolving via the `react-server`
// export condition (which points to an empty module). Vitest doesn't know
// about that condition, so it hits the throwing entry and every test file
// that transitively imports a server module (lib/agent/hermes-client.ts,
// lib/cost/db.ts, etc.) fails at import time:
//
//   Error: This module cannot be imported from a Client Component module.
//          It should only be used from a Server Component.
//
// We alias `server-only` to this empty file in vitest.config.ts so the
// import resolves to a no-op. The test environment is server-shaped anyway
// (jsdom global, vi.mock for fetch), so the directive is meaningless here.
export {};
