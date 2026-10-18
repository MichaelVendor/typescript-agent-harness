import { startControl } from "./http.js";
import { createDockerRuntime, sweepIdle, type DockerRuntimeOptions } from "./runtime.js";
import { openStore } from "./store.js";

const secret = process.env.AR_SHARED_SECRET;
if (!secret) {
  console.error("control: AR_SHARED_SECRET is required");
  process.exit(1);
}

const dataDir = process.env.CONTROL_DATA ?? "./.control-data";
const image = process.env.CONTROL_IMAGE ?? "tah-agent-host";
const host = process.env.CONTROL_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_PORT ?? "7810");
const idleMs = 30 * 60 * 1000;
const lastTouch = new Map<string, number>();
const runtimeOpts: DockerRuntimeOptions = { dataDir, image, secret, lastTouch };
if (process.env.DEEPSEEK_API_KEY) runtimeOpts.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
if (process.env.OPENAI_API_KEY) runtimeOpts.openaiApiKey = process.env.OPENAI_API_KEY;
const runtime = createDockerRuntime(runtimeOpts);

const { url } = await startControl({
  store: openStore(`${dataDir}/control.db`),
  runtime,
  lastTouch,
  secret,
  host,
  port,
});
setInterval(() => {
  sweepIdle(runtime, lastTouch, Date.now(), idleMs);
}, idleMs);
console.log(`control listening on ${url}`);
