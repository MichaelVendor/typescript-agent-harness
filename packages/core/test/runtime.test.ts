import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Runtime,
  createServiceKey,
  type Plugin,
} from "@typescript-agent-harness/core";

test("start and stop emit lifecycle events in order", async () => {
  const seen: string[] = [];
  const ping = createServiceKey<{ n: number }>("test.ping");
  const plugin: Plugin = {
    name: "ping",
    setup(ctx) {
      ctx.provide(ping, { n: 1 });
    },
    async dispose() {},
  };

  const runtime = new Runtime({ id: "t1" });
  runtime.on("runtime.starting", () => {
    seen.push("starting");
  });
  runtime.on("plugin.setup", () => {
    seen.push("setup");
  });
  runtime.on("runtime.started", () => {
    seen.push("started");
  });
  runtime.on("runtime.stopping", () => {
    seen.push("stopping");
  });
  runtime.on("plugin.dispose", () => {
    seen.push("dispose");
  });
  runtime.on("runtime.stopped", () => {
    seen.push("stopped");
  });

  runtime.use(plugin);
  await runtime.start();
  assert.equal(runtime.get(ping).n, 1);
  await runtime.stop();

  assert.deepEqual(seen, [
    "starting",
    "setup",
    "started",
    "stopping",
    "dispose",
    "stopped",
  ]);
});

test("reject duplicate plugin names and use after start", async () => {
  const runtime = new Runtime({ id: "t2" });
  const empty: Plugin = { name: "a", setup() {} };
  runtime.use(empty);
  assert.throws(() => runtime.use({ name: "a", setup() {} }), /Duplicate plugin name/);
  await runtime.start();
  assert.throws(() => runtime.use({ name: "b", setup() {} }), /after runtime has started/);
  await runtime.stop();
});

test("waterfall runs interceptors outermost-first and can short-circuit", async () => {
  const runtime = new Runtime({ id: "t4" });
  const ctx = runtime.context();
  const order: string[] = [];
  ctx.intercept<number, string>("calc", async (n, next) => {
    order.push("outer");
    return `[${await next(n + 1)}]`;
  });
  const off = ctx.intercept<number, string>("calc", async (n, next) => {
    order.push("inner");
    if (n > 10) return "blocked";
    return next(n * 2);
  });

  assert.equal(await ctx.waterfall("calc", 1, async (n) => String(n)), "[4]");
  assert.deepEqual(order, ["outer", "inner"]);
  assert.equal(await ctx.waterfall("calc", 20, async (n) => String(n)), "[blocked]");

  off();
  assert.equal(await ctx.waterfall("calc", 1, async (n) => String(n)), "[2]");
  assert.equal(await ctx.waterfall("none", 7, async (n) => n), 7);
});

test("get before start throws", () => {
  const KEY = createServiceKey<number>("x");
  const runtime = new Runtime({ id: "t3" });
  assert.throws(() => runtime.get(KEY), /not running/);
});
