import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("discord-plugin setup (stub)");
  },
  async onHealth() {
    return { status: "ok" };
  },
});

runWorker(plugin, import.meta.url);
