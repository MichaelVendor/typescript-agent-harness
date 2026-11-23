import { timingSafeEqual } from "node:crypto";

const BEARER_RE = /^Bearer\s+(\S+)/i;

/** Returns true if Authorization Bearer matches token (timing-safe). */
export function checkWorkerBearer(header: string | undefined, token: string): boolean {
  if (header === undefined) {
    return false;
  }
  const match = BEARER_RE.exec(header);
  if (!match) {
    return false;
  }
  const value = match[1];
  if (value === undefined) {
    return false;
  }
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}