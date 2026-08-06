import { describe, expect, it } from "vitest";
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  parseCookies,
  resolveSessionUser,
  sessionCookie,
  type SessionStore,
} from "./session";

function fakeStore(): SessionStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
    async del(k) {
      data.delete(k);
    },
  };
}

describe("session auth", () => {
  it("round-trips a session through the store", async () => {
    const store = fakeStore();
    const id = await createSession(store, 42n);
    const user = await resolveSessionUser(store, sessionCookie(id));
    expect(user).toBe(42n);
  });

  it("rejects a missing or unknown cookie", async () => {
    const store = fakeStore();
    expect(await resolveSessionUser(store, undefined)).toBeNull();
    expect(await resolveSessionUser(store, "angy_session=nope")).toBeNull();
    expect(await resolveSessionUser(store, "other=1; theme=dark")).toBeNull();
  });

  it("rejects tampered session payloads", async () => {
    const store = fakeStore();
    const id = await createSession(store, 7n);
    store.data.set(`session:${id}`, "DROP TABLE app_user");
    expect(await resolveSessionUser(store, sessionCookie(id))).toBeNull();
  });

  it("destroys sessions", async () => {
    const store = fakeStore();
    const id = await createSession(store, 7n);
    await destroySession(store, id);
    expect(await resolveSessionUser(store, sessionCookie(id))).toBeNull();
  });

  it("parses cookie headers defensively", () => {
    expect(parseCookies("a=1; b=2%20x; malformed")).toEqual({ a: "1", b: "2 x" });
  });

  it("emits httpOnly lax cookies and a clearing counterpart", () => {
    expect(sessionCookie("abc")).toContain("HttpOnly");
    expect(sessionCookie("abc")).toContain("SameSite=Lax");
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });

  // Secure is derived from the public origin's scheme (ADR 0012). Both
  // directions matter: omitting it on https leaks the session on a downgrade,
  // and forcing it on plain-http dev means the browser never stores the cookie
  // at all — a failure that presents as "sign-in silently does nothing".
  it("adds Secure only when asked, on both the set and clear cookies", () => {
    expect(sessionCookie("abc", { secure: true })).toContain("; Secure");
    expect(sessionCookie("abc", { secure: false })).not.toContain("Secure");
    expect(clearedSessionCookie({ secure: true })).toContain("; Secure");
    expect(clearedSessionCookie({ secure: false })).not.toContain("Secure");
  });

  // A host-only cookie set by api.<domain> is never sent to <domain>, so the
  // RSC render forwards no session and bounces a signed-in user to /signin.
  // Invisible in dev, where both are `localhost` (cookies ignore ports).
  it("scopes to a domain only when one is given", () => {
    expect(sessionCookie("abc")).not.toContain("Domain=");
    expect(sessionCookie("abc", { domain: "example.com" })).toContain("; Domain=example.com");
  });

  // Clearing a domain-scoped cookie with a host-only Set-Cookie is a no-op:
  // sign-out looks like it worked and the session is still live.
  it("clears with the same Domain it set", () => {
    expect(clearedSessionCookie({ domain: "example.com" })).toContain("; Domain=example.com");
  });
});
