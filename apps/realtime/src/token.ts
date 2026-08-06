import { jwtVerify } from "jose";
import { env } from "./env.js";

export interface RealtimeClaims {
  userId: string;
  name: string;
  pageId: string;
}

/**
 * Verify a short-lived realtime connect token (ADR 0008). Signed by the API
 * with JWT_SECRET — this is NOT user auth (that's OIDC + Redis sessions).
 */
export async function verifyRealtimeToken(token: string): Promise<RealtimeClaims> {
  const secret = new TextEncoder().encode(env.jwtSecret());
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (typeof payload.sub !== "string" || typeof payload.page !== "string") {
    throw new Error("Malformed realtime token");
  }
  return {
    userId: payload.sub,
    pageId: payload.page,
    name: typeof payload.name === "string" ? payload.name : "Unknown",
  };
}
