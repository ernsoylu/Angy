import { randomUUID } from "node:crypto";

/** Sessions live in Redis (CLAUDE.md: OIDC auth, sessions in Redis). */
export const SESSION_COOKIE = "angy_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The subset of the Redis API sessions need — lets tests use an in-memory fake. */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

const key = (id: string) => `session:${id}`;

export async function createSession(store: SessionStore, userId: bigint): Promise<string> {
  const id = randomUUID();
  await store.set(key(id), userId.toString(), "EX", SESSION_TTL_SECONDS);
  return id;
}

export async function destroySession(store: SessionStore, sessionId: string): Promise<void> {
  await store.del(key(sessionId));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** Resolve the session cookie in a Cookie header to a user id, or null. */
export async function resolveSessionUser(
  store: SessionStore,
  cookieHeader: string | undefined,
): Promise<bigint | null> {
  const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!sessionId) return null;
  const raw = await store.get(key(sessionId));
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/**
 * `Secure` is driven by the public origin rather than hardcoded: local dev is
 * plain http, where a Secure cookie would simply never be stored, and any
 * https deployment must have it or the session travels in the clear on a
 * downgrade.
 *
 * SameSite stays Lax. The web app and the API sit on sibling subdomains of one
 * registrable domain, so credentialed XHR between them is same-site and Lax
 * permits it; it also survives the top-level OIDC redirect back from the IdP.
 */
export interface CookieOptions {
  secure?: boolean;
  /**
   * Omit for a host-only cookie. Set it when the browser must send the session
   * to more than one host — a web app and an API on sibling subdomains are
   * *different hosts*, and a host-only cookie set by one never reaches the
   * other, however same-site they are.
   */
  domain?: string;
}

function attributes({ secure, domain }: CookieOptions): string {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function sessionCookie(sessionId: string, opts: CookieOptions = {}): string {
  return `${SESSION_COOKIE}=${sessionId}; ${attributes(opts)}; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** Must carry the same Domain as the cookie it clears, or it clears nothing. */
export function clearedSessionCookie(opts: CookieOptions = {}): string {
  return `${SESSION_COOKIE}=; ${attributes(opts)}; Max-Age=0`;
}
