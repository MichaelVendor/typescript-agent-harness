import { createHmac, timingSafeEqual } from "node:crypto";

export type AgentHostClaims = {
  projectId: string;
  userId: string;
  exp: number; // unix seconds
  sessionId?: string;
};

function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signAgentHostToken(secret: string, claims: AgentHostClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signPayload(secret, payload)}`;
}

export function verifyAgentHostToken(
  secret: string,
  token: string,
  expectedProjectId: string,
  nowSec = Math.floor(Date.now() / 1000),
): AgentHostClaims {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    throw new Error("invalid token");
  }
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!signaturesMatch(signPayload(secret, payload), signature)) {
    throw new Error("invalid token");
  }

  let claims: AgentHostClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AgentHostClaims;
  } catch {
    throw new Error("invalid token");
  }

  if (claims.exp < nowSec) {
    throw new Error("token expired");
  }
  if (claims.projectId !== expectedProjectId) {
    throw new Error("project mismatch");
  }
  return claims;
}
