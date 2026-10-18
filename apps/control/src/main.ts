import { startControl } from "./http.js";
import { createFakeRuntime, sweepIdle } from "./runtime.js";
import { openStore } from "./store.js";

const dataDir = process.env.CONTROL_DATA ?? "./.control-data";
const host = process.env.CONTROL_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_PORT ?? "7810");
const idleMs = 30 * 60 * 1000;
const runtime = createFakeRuntime();
const lastTouch = new Map<string, number>();

const { url } = await startControl({
  store: openStore(`${dataDir}/control.db`),
  runtime,
  lastTouch,
  host,
  port,
});
setInterval(() => {
  sweepIdle(runtime, lastTouch, Date.now(), idleMs);
}, idleMs);
console.log(`control listening on ${url}`);
