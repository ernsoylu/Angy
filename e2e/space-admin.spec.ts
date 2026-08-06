import { expect, test } from "@playwright/test";
import { api } from "./helpers";

const API = "http://localhost:3001";

/** Raw call that keeps the failure body — these tests assert on refusals. */
async function raw(
  session: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; success: boolean; message?: string; data?: unknown }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      cookie: `angy_session=${session}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = await res.json();
  return {
    status: res.status,
    success: body.success,
    message: body.error?.message,
    data: body.data,
  };
}

/**
 * Wave E: space administration. Everything here runs in a throwaway PRIVATE
 * space so it never perturbs the seeded membership other specs rely on.
 */
test.describe("space administration", () => {
  test("membership changes take effect immediately, across every page", async () => {
    test.setTimeout(90_000);
    const key = `at-${Date.now().toString(36)}`;

    // Creating a space makes the creator its first admin.
    const created = await api<{ id: string; key: string }>("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({
        key,
        name: "Admin Test",
        visibility: "PRIVATE",
        defaultPermLevel: "VIEW",
      }),
    });
    const spaceId = created.id;

    const members = await api<{ displayName: string; permLevel: string }[]>(
      "e2e-eren",
      `/spaces/${spaceId}/members`,
    );
    expect(members).toHaveLength(1);
    expect(members[0]!.permLevel).toBe("ADMIN");

    const page = await api<{ id: string }>("e2e-eren", "/pages", {
      method: "POST",
      body: JSON.stringify({ spaceId, title: "Governed" }),
    });

    // Private space, no membership: Ada cannot even read it.
    expect((await raw("e2e-ada", `/spaces/${spaceId}`)).success).toBe(false);

    // Invite as EDIT — read and edit both open up.
    await api("e2e-eren", `/spaces/${spaceId}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: "ada@acme.io", permLevel: "EDIT" }),
    });
    expect((await raw("e2e-ada", `/spaces/${spaceId}`)).success).toBe(true);
    expect((await raw("e2e-ada", `/pages/${page.id}/realtime-token`)).success).toBe(true);

    // Demote to VIEW — still readable, no longer editable. This is the case
    // the space-wide bitmap invalidation exists for: a cached EDIT bit would
    // otherwise keep answering yes.
    await api("e2e-eren", `/spaces/${spaceId}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: "ada@acme.io", permLevel: "VIEW" }),
    });
    expect((await raw("e2e-ada", `/spaces/${spaceId}`)).success).toBe(true);
    expect((await raw("e2e-ada", `/pages/${page.id}/realtime-token`)).success).toBe(false);

    // Remove entirely — back to no access at all.
    const withAda = await api<{ userId: string; email: string }[]>(
      "e2e-eren",
      `/spaces/${spaceId}/members`,
    );
    const adaId = withAda.find((m) => m.email === "ada@acme.io")!.userId;
    await api("e2e-eren", `/spaces/${spaceId}/members/${adaId}`, { method: "DELETE" });
    expect((await raw("e2e-ada", `/spaces/${spaceId}`)).success).toBe(false);
  });

  test("only admins administer, and a space keeps its last one", async () => {
    const key = `ag-${Date.now().toString(36)}`;
    const created = await api<{ id: string }>("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({ key, name: "Admin Guard", visibility: "PRIVATE" }),
    });
    const spaceId = created.id;

    await api("e2e-eren", `/spaces/${spaceId}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: "ada@acme.io", permLevel: "EDIT" }),
    });

    // An editor cannot promote herself.
    const escalation = await raw("e2e-ada", `/spaces/${spaceId}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: "ada@acme.io", permLevel: "ADMIN" }),
    });
    expect(escalation.success).toBe(false);
    expect(escalation.message).toContain("admin");

    // Nor rename the space.
    const rename = await raw("e2e-ada", `/spaces/${spaceId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(rename.success).toBe(false);

    // The last admin cannot be removed — a space with none can never be
    // administered again.
    const admins = await api<{ userId: string; email: string; permLevel: string }[]>(
      "e2e-eren",
      `/spaces/${spaceId}/members`,
    );
    const erenId = admins.find((m) => m.permLevel === "ADMIN")!.userId;
    const lastAdmin = await raw("e2e-eren", `/spaces/${spaceId}/members/${erenId}`, {
      method: "DELETE",
    });
    expect(lastAdmin.success).toBe(false);
    expect(lastAdmin.message).toContain("at least one admin");
  });

  test("an unknown email is refused with a reason, not a silent no-op", async () => {
    const key = `ai-${Date.now().toString(36)}`;
    const created = await api<{ id: string }>("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({ key, name: "Invite Test" }),
    });
    const invite = await raw("e2e-eren", `/spaces/${created.id}/members`, {
      method: "PUT",
      body: JSON.stringify({ email: "nobody@acme.io", permLevel: "VIEW" }),
    });
    expect(invite.success).toBe(false);
    // SCIM is V2: there is no provisioning path, so this has to be explained.
    expect(invite.message).toContain("sign in once");
  });

  test("a duplicate space key is refused", async () => {
    const key = `ad-${Date.now().toString(36)}`;
    await api("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({ key, name: "First" }),
    });
    const second = await raw("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({ key, name: "Second" }),
    });
    expect(second.success).toBe(false);
    expect(second.message).toContain("already in use");
  });
});
