import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { api, articleBody, sessionContext } from "./helpers";

/**
 * Importing an export archive (V2 H2) — the half of the importer the Markdown
 * engine could not do on its own.
 *
 * What only an e2e can show: a `.zip` that a wiki produced becomes real pages,
 * its images become Angy attachments served from object storage, and the links
 * between its files land on `/p/{id}` instead of the relative paths they were
 * written as. Every one of those is a different subsystem agreeing, and the
 * reader is where the agreement is visible.
 */

interface ImportResult {
  created: { id: string; title: string; path: string }[];
  skipped: { path: string; reason: string }[];
  attachments: number;
}

/** A genuine 1×1 PNG: the thumbnail worker decodes what it is given. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function importArchive(
  session: string,
  spaceId: number,
  files: Record<string, Uint8Array>,
): Promise<{ status: number; body: { success: boolean; data: ImportResult } }> {
  const form = new FormData();
  form.append("file", new File([zipSync(files)], "export.zip", { type: "application/zip" }));
  const res = await fetch(`http://localhost:3001/spaces/${spaceId}/import/archive`, {
    method: "POST",
    headers: { cookie: `angy_session=${session}` },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

async function trash(created: { id: string }[]) {
  for (const page of created) {
    await api("e2e-eren", `/pages/${page.id}/trash`, { method: "POST" }).catch(() => {});
  }
}

test.describe("export archive import", () => {
  test("a zip becomes pages whose media and links belong to Angy", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    // Shaped like a Notion export: the 32-hex page id on every name, children
    // in a folder named after their parent, references percent-encoded.
    const parent = `Field guide ${stamp} 24d0e0e5f5e2809ab5a5cdb6ca1ea1e0`;
    const child = `Onboarding ${stamp} aabbccddeeff00112233445566778899`;
    const { body } = await importArchive("e2e-eren", 1, {
      [`Export-${stamp}/${parent}.md`]: strToU8(
        [
          `# Field guide ${stamp}`,
          "",
          `![Logo](${encodeURIComponent(parent)}/logo.png)`,
          "",
          `Start with [onboarding](${encodeURIComponent(parent)}/${encodeURIComponent(child)}.md).`,
          "",
        ].join("\n"),
      ),
      [`Export-${stamp}/${parent}/${child}.md`]: strToU8(`# Onboarding ${stamp}\n\nFirst week.\n`),
      [`Export-${stamp}/${parent}/logo.png`]: PNG,
      // Debris every macOS zip carries, and never a page.
      "__MACOSX/._junk": strToU8("junk"),
    });

    const result = body.data;
    expect(body.success).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.attachments).toBe(1);

    // The wrapper folder is a page too, so the whole import has one root to
    // move or trash. Titles lost the export id; nothing lost its place — and a
    // folder name reads as a title, hyphens and all ("Export-9f2" → "Export 9f2").
    const root = result.created.find((p) => p.title === `Export ${stamp}`)!;
    const guide = result.created.find((p) => p.title === `Field guide ${stamp}`)!;
    const onboarding = result.created.find((p) => p.title === `Onboarding ${stamp}`)!;
    expect(root).toBeDefined();
    expect(guide).toBeDefined();
    expect(onboarding).toBeDefined();

    // The reader serves it — true only once the worker turned the imported
    // document_json into a Y.Doc and rendered the projection.
    await expect(async () => {
      await page.goto(`/s/eng/${guide.id}`);
      await expect(articleBody(page)).toContainText("Start with", { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // The image is Angy's now: content-addressed in object storage, not the
    // folder path the archive wrote.
    const image = articleBody(page).locator("img").first();
    await expect(image).toHaveAttribute("src", /\/media\/[0-9a-f]{64}$/);

    // And the link between two files in the archive resolves through the page
    // id — never `/s/{key}/{id}`, which goes stale the moment a page moves.
    await expect(articleBody(page).locator(`a[href="/p/${onboarding.id}"]`)).toHaveCount(1);

    // The attachment is a real row, so the media library and the 30-day GC see
    // it like any upload.
    const attachments = await api<{ fileName: string; pageTitle: string | null }[]>(
      "e2e-eren",
      "/spaces/1/attachments",
    );
    expect(attachments.some((a) => a.fileName === "logo.png")).toBe(true);

    // The tree nests: the child hangs off the file that stood for its folder.
    const detail = await api<{ breadcrumb: { title: string }[] }>(
      "e2e-eren",
      `/pages/${onboarding.id}`,
    );
    expect(detail.breadcrumb.map((c) => c.title)).toContain(`Field guide ${stamp}`);

    await trash(result.created);
    await context.close();
  });

  test("what it could not place comes back with a reason", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-eren");
    const stamp = Date.now().toString(36);

    const { body } = await importArchive("e2e-eren", 1, {
      [`notes-${stamp}.md`]: strToU8(`# Notes ${stamp}\n\n![Missing](gone.png)\n`),
      [`orphan-${stamp}.png`]: PNG,
      [`page-${stamp}.html`]: strToU8("<h1>Exported as HTML</h1>"),
    });

    const reasons = body.data.skipped;
    // A silent drop is the failure mode a migration cannot recover from: the
    // person importing has no way to know a file never arrived.
    expect(reasons.find((s) => s.path === `gone.png`)?.reason).toContain("not in the archive");
    expect(reasons.find((s) => s.path === `orphan-${stamp}.png`)?.reason).toContain(
      "Not referenced",
    );
    expect(reasons.find((s) => s.path === `page-${stamp}.html`)?.reason).toContain("re-export");

    await trash(body.data.created);
    await context.close();
  });

  test("the import screen drives it end to end", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await sessionContext(browser, "e2e-eren");
    const page = await context.newPage();
    const stamp = Date.now().toString(36);

    await page.goto("/s/eng/import");
    await expect(page.getByRole("heading", { name: "Import content" })).toBeVisible();

    const archive = zipSync({
      [`Runbook ${stamp}.md`]: strToU8(`# Runbook ${stamp}\n\nWhat to do at 3am.\n`),
    });
    await page.getByLabel("Export archive").setInputFiles({
      name: "export.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
    await page.getByRole("button", { name: "Import into this space" }).click();

    const created = page.getByTestId("import-created");
    await expect(created).toContainText(`Runbook ${stamp}`, { timeout: 60_000 });

    const pages = await api<{ id: string; title: string }[]>("e2e-eren", "/spaces/1/pages");
    await trash(pages.filter((p) => p.title === `Runbook ${stamp}`));
    await context.close();
  });

  test("importing an archive needs edit access to the space", async ({ browser }) => {
    const context = await sessionContext(browser, "e2e-ada");
    // Ada is not a member of the private Product space.
    const { status } = await importArchive("e2e-ada", 2, { "x.md": strToU8("# X\n") });
    expect(status).toBe(403);
    await context.close();
  });
});
