import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
export const COOKIE_NAME = "sid";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const sep = stored.indexOf(":");
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), "hex");
  const expected = Buffer.from(stored.slice(sep + 1), "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type Session = { userId: string; username: string };

export function createSessions() {
  const sessions = new Map<string, Session>();
  return {
    create(user: Session): string {
      const id = randomUUID();
      sessions.set(id, user);
      return id;
    },
    get(id: string): Session | undefined {
      return sessions.get(id);
    },
    destroy(id: string): void {
      sessions.delete(id);
    },
  };
}

export function sessionCookie(id: string): string {
  return `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionId(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}
