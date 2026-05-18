// Mock for `server-only` package in Vitest / Node test environment.
// In production, Next.js replaces this with a runtime error for client bundles.
// In tests we run in Node so this is always safe to import.
export {};
