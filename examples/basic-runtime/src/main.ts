/**
 * Phase 1 demo: Runtime + Plugin + Context + Service + EventBus
 *
 * Plugins never import each other. They only talk through Context:
 *   - provide / get services
 *   - emit / on events
 */
import {
  createServiceKey,
  Runtime,
  type Context,
  type Plugin,
} from "@typescript-agent-harness/core";

// ─── Capability contracts (shared types only, no implementations) ───────────

interface Greeter {
  greet(name: string): string;
}

interface Counter {
  increment(): number;
  value(): number;
}

const GREETER = createServiceKey<Greeter>("demo.greeter");
const COUNTER = createServiceKey<Counter>("demo.counter");

// ─── Plugins ────────────────────────────────────────────────────────────────

function greeterPlugin(): Plugin {
  return {
    name: "greeter",
    setup(ctx) {
      ctx.provide(GREETER, {
        greet(name) {
          return `Hello, ${name}!`;
        },
      });
    },
  };
}

function counterPlugin(): Plugin {
  return {
    name: "counter",
    setup(ctx) {
      let n = 0;
      ctx.provide(COUNTER, {
        increment() {
          n += 1;
          void ctx.emit("demo.counter.changed", { value: n });
          return n;
        },
        value: () => n,
      });
    },
  };
}

/** Observer: no services, only listens — Trace/Metrics/Billing will look like this. */
function tracePlugin(): Plugin {
  return {
    name: "trace",
    setup(ctx) {
      // Subscriptions live until Runtime.stop() clears the bus.
      ctx.on("runtime.started", (e) => {
        console.log(`[trace] runtime.started id=${e.runtimeId}`);
      });
      ctx.on("plugin.setup", (e) => {
        console.log(`[trace] plugin.setup name=${e.name}`);
      });
      ctx.on("demo.counter.changed", (e) => {
        const payload = e as { value: number };
        console.log(`[trace] counter -> ${payload.value}`);
      });
      ctx.on("runtime.stopped", (e) => {
        console.log(`[trace] runtime.stopped id=${e.runtimeId}`);
      });
    },
  };
}

/**
 * App plugin: consumes capabilities registered by others.
 * This is the Application layer sitting on top of the Runtime.
 */
function appPlugin(): Plugin {
  return {
    name: "app",
    async setup(ctx: Context) {
      const greeter = ctx.get(GREETER);
      const counter = ctx.get(COUNTER);

      console.log(greeter.greet("Agent Runtime"));
      counter.increment();
      counter.increment();
      console.log(`final count = ${counter.value()}`);
    },
  };
}

// ─── Boot ───────────────────────────────────────────────────────────────────

async function main() {
  const runtime = new Runtime({ id: "demo-1" });

  runtime
    .use(tracePlugin()) // observers first is fine; events fire as others setup
    .use(greeterPlugin())
    .use(counterPlugin())
    .use(appPlugin());

  await runtime.start();
  await runtime.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
