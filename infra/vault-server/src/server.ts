import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  registerHealthRoute(app);

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`vault-server listening on :${config.port}`);
}

main().catch((err) => {
  console.error("vault-server failed to start:", err);
  process.exit(1);
});
