import { definePlugin } from "@typescript-agent-harness/cli";

// Registered as plugin "project:audit-log", after every built-in plugin.
export default definePlugin({
  setup(ctx) {
    ctx.on("tool.finished", (e) => {
      const { tool, output } = e as { tool: string; output: unknown };
      console.error(`[audit] ${tool} → ${JSON.stringify(output)}`);
    });
  },
});
