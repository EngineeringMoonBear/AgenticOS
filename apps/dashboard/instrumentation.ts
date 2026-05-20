export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootScheduler } = await import("@/lib/scheduler/scheduler");
    await bootScheduler();
  }
}
