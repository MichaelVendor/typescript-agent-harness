import { createServiceKey, type Plugin } from "@typescript-agent-harness/core";
import type { SchedulerService } from "./types.js";

export const SCHEDULER = createServiceKey<SchedulerService>("scheduler");

export function schedulerPlugin(): Plugin {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    name: "scheduler",
    setup(ctx) {
      const run = async (name: string, job: () => void | Promise<void>) => {
        await ctx.emit("scheduler.job.start", { jobId: name });
        try {
          await job();
          await ctx.emit("scheduler.job.end", { jobId: name, status: "ok" });
        } catch (error) {
          await ctx.emit("scheduler.job.end", {
            jobId: name,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      const service: SchedulerService = {
        once(name, delayMs, job) {
          this.cancel(name);
          const timer = setTimeout(() => {
            timers.delete(name);
            void run(name, job);
          }, delayMs);
          timers.set(name, timer);
        },
        every(name, intervalMs, job) {
          this.cancel(name);
          const timer = setInterval(() => {
            void run(name, job);
          }, intervalMs);
          timers.set(name, timer);
        },
        cancel(name) {
          const timer = timers.get(name);
          if (!timer) return;
          clearTimeout(timer);
          clearInterval(timer);
          timers.delete(name);
        },
      };

      ctx.provide(SCHEDULER, service);
    },
    dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      timers.clear();
    },
  };
}
