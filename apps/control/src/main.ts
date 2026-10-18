import { openStore } from "./store.js";
import { startControl } from "./http.js";

const dataDir = process.env.CONTROL_DATA ?? "./.control-data";
const host = process.env.CONTROL_HOST ?? "127.0.0.1";
const port = Number(process.env.CONTROL_PORT ?? "7810");

const { url } = await startControl({
  store: openStore(`${dataDir}/control.db`),
  host,
  port,
});
console.log(`control listening on ${url}`);
