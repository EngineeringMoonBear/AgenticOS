export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootScheduler } = await import("@/lib/scheduler/scheduler");
    const { bootMcpServer } = await import("@/lib/mcp-vault/server");
    await Promise.all([bootScheduler(), bootMcpServer()]);
  }
}
