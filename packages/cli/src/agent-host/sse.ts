import type { ServerResponse } from "node:http";
import type { HostEvent } from "../host.js";

export function writeHostEvent(res: ServerResponse, event: HostEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
