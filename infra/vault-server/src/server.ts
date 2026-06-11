import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerTreeRoute } from "./routes/tree.js";
import { registerPageRoute } from "./routes/page.js";
import { registerStatsRoute } from "./routes/stats.js";
import { registerBacklinksRoute } from "./routes/backlinks.js";
import { registerSearchRoute } from "./routes/search.js";
import { registerInboxRoute } from "./routes/inbox.js";
import { registerRecentChangesRoute } from "./routes/recent-changes.js";
import { registerSkillsRoute } from "./routes/skills.js";
import { registerDiscardRoute } from "./routes/discard.js";
import { registerInboxReadRoute } from "./routes/inbox-read.js";
import { registerPageWriteRoute } from "./routes/page-write.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  registerHealthRoute(app);
  registerTreeRoute(app, config);
  registerPageRoute(app, config);
  registerStatsRoute(app, config);
  registerBacklinksRoute(app, config);
  registerSearchRoute(app, config);
  registerInboxRoute(app, config);
  registerRecentChangesRoute(app, config);
  registerSkillsRoute(app, config);
  registerDiscardRoute(app, config);
  registerInboxReadRoute(app, config);
  registerPageWriteRoute(app, config);

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`vault-server listening on :${config.port}`);
}

main().catch((err) => {
  console.error("vault-server failed to start:", err);
  process.exit(1);
});
