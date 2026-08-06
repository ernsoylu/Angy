import { expect, test } from "@playwright/test";
import { api, pageIdBySlug, sessionContext } from "./helpers";

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

  test("the settings screen is admin-only and saves identity behind Save", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng/settings");
    await expect(page.getByRole("heading", { name: "Space settings" })).toBeVisible();

    // The key is permanent — rendered, but not an input.
    await expect(page.getByText("Permanent. The key is in every page URL")).toBeVisible();

    // Identity is staged: Save is inert until something actually changes.
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();
    const name = page.getByRole("textbox").first();
    const original = await name.inputValue();
    await name.fill(`${original} Renamed`);
    await expect(save).toBeEnabled();

    // Discard puts it back without touching the server.
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(name).toHaveValue(original);
    await expect(save).toBeDisabled();

    // A real save round-trips.
    await name.fill(`${original} Renamed`);
    await save.click();
    await expect(page.getByText("Space updated")).toBeVisible();
    const after = await api<{ name: string }>("e2e-eren", "/spaces/1");
    expect(after.name).toBe(`${original} Renamed`);
    await api("e2e-eren", "/spaces/1", {
      method: "PATCH",
      body: JSON.stringify({ name: original }),
    });
    await context.close();

    // A non-admin gets the restricted state, not a half-usable form.
    const adaContext = await sessionContext(browser, "e2e-ada");
    const ada = await adaContext.newPage();
    await ada.goto("/s/eng/settings");
    await expect(ada.getByText("You don't have access to this page")).toBeVisible();
    await expect(ada.getByRole("heading", { name: "Space settings" })).toHaveCount(0);
    await adaContext.close();
  });

  test("trashing a space hides it everywhere; restoring brings it back", async () => {
    test.setTimeout(90_000);
    const key = `td-${Date.now().toString(36)}`;
    const space = await api<{ id: string }>("e2e-eren", "/spaces", {
      method: "POST",
      body: JSON.stringify({ key, name: "Trashable" }),
    });

    const listed = async () =>
      (await api<{ id: string }[]>("e2e-eren", "/spaces")).some((s) => s.id === space.id);
    expect(await listed()).toBe(true);

    await api("e2e-eren", `/spaces/${space.id}`, { method: "DELETE" });
    // Gone from the switcher, and no longer directly readable.
    expect(await listed()).toBe(false);
    expect((await raw("e2e-eren", `/spaces/${space.id}`)).success).toBe(false);
    // Trashing twice is refused rather than silently re-stamping the clock.
    expect((await raw("e2e-eren", `/spaces/${space.id}`, { method: "DELETE" })).success).toBe(
      false,
    );

    await api("e2e-eren", `/spaces/${space.id}/restore`, { method: "POST" });
    expect(await listed()).toBe(true);
    expect((await raw("e2e-eren", `/spaces/${space.id}/restore`, { method: "POST" })).success).toBe(
      false,
    );
  });

  test("the create-space dialog suggests a key and lands in the new space", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng");

    await page.getByRole("button", { name: "New space" }).click();
    const dialog = page.getByRole("dialog", { name: "New space" });
    await expect(dialog).toBeVisible();

    // The key is derived from the name, so most people never touch it.
    const name = `Design Ops ${Date.now().toString(36)}`;
    await dialog.getByPlaceholder("Engineering").fill(name);
    const keyField = dialog.getByLabel("Space key");
    await expect(keyField).toHaveValue(/^design-ops-/);
    // Keys are capped, so take the suggestion rather than a long literal.
    const key = (await keyField.inputValue()).slice(0, 20).replace(/-+$/, "");
    await keyField.fill(key);
    await expect(dialog.getByText("Permanent — it goes into every page URL")).toBeVisible();

    await dialog.getByRole("button", { name: "Create space" }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${key}$`));
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // The creator is its first admin, so settings opens rather than refusing.
    await page.goto(`/s/${key}/settings`);
    await expect(page.getByRole("heading", { name: "Space settings" })).toBeVisible();
    await context.close();
  });

  test("tag cleanup lives in settings and reports refusals", async ({ browser }) => {
    test.setTimeout(90_000);
    // A tag confined to Engineering, which Eren fully administers.
    const pageId = await pageIdBySlug("e2e-eren", "onboarding");
    // Tags are workspace-wide and survive a reseed (the seed only cascades page
    // rows), so both names have to be unique to this run.
    const stamp = Date.now().toString(36);
    const before = `typoo-${stamp}`;
    const after = `typo-${stamp}`;
    await api("e2e-eren", `/pages/${pageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [before] }),
    });

    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    await page.goto("/s/eng/settings");
    await expect(page.getByText("Tags are shared across every space")).toBeVisible();

    const row = page.getByTestId(`tag-row-${before}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Rename" }).click();
    await row.getByLabel(`New name for ${before}`).fill(after);
    await row.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Tag renamed")).toBeVisible();

    const tags = await api<{ name: string }[]>("e2e-eren", `/tags?q=${after}`);
    expect(tags.some((t) => t.name === after)).toBe(true);

    await api("e2e-eren", `/pages/${pageId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags: [] }),
    });
    await context.close();
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
