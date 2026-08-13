import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPage } from "../src/closure.js";
import { filterReadablePages } from "../src/permissions.js";
import { TEST_URL } from "./global-setup.js";

/**
 * The batched read filter is what stops list surfaces (backlinks, and mentions
 * next) disclosing pages the caller cannot open — each row carries a title, so
 * an unfiltered list leaks one. These cases are the leak, not the ordering.
 */

const prisma = new PrismaClient({ datasourceUrl: TEST_URL });

let outsider: bigint;
let member: bigint;
let publicPage: string;
let privatePage: string;
let grantedPage: string;
let trashedPage: string;
let pageInTrashedSpace: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.appUser.create({
      data: { oidcSubject: "test|outsider", email: "outsider@test.io", displayName: "Outsider" },
    }),
    prisma.appUser.create({
      data: { oidcSubject: "test|member", email: "member@test.io", displayName: "Member" },
    }),
  ]);
  outsider = a.id;
  member = b.id;

  const open = await prisma.space.create({
    data: { key: "perm-public", name: "Public", visibility: "PUBLIC", defaultPermLevel: "VIEW" },
  });
  const closed = await prisma.space.create({
    data: { key: "perm-private", name: "Private", visibility: "PRIVATE" },
  });
  const doomed = await prisma.space.create({
    data: { key: "perm-doomed", name: "Doomed", visibility: "PUBLIC" },
  });
  await prisma.spaceMember.create({
    data: { spaceId: closed.id, userId: member, permLevel: "EDIT" },
  });

  const mk = async (spaceId: bigint, title: string, slug: string) =>
    (await createPage(prisma, { spaceId, title, slug, createdBy: member })).id;

  publicPage = await mk(open.id, "Public Page", "public-page");
  privatePage = await mk(closed.id, "Private Page", "private-page");
  grantedPage = await mk(closed.id, "Granted Page", "granted-page");
  trashedPage = await mk(open.id, "Trashed Page", "trashed-page");
  pageInTrashedSpace = await mk(doomed.id, "Orphan", "orphan");

  await prisma.pagePermission.create({
    data: { pageId: grantedPage, userId: outsider, permLevel: "VIEW", grantedBy: member },
  });
  await prisma.page.update({ where: { id: trashedPage }, data: { deletedAt: new Date() } });
  await prisma.space.update({ where: { id: doomed.id }, data: { deletedAt: new Date() } });
});

afterAll(() => prisma.$disconnect());

describe("filterReadablePages", () => {
  const all = () => [publicPage, privatePage, grantedPage, trashedPage, pageInTrashedSpace];

  it("keeps a public space's baseline pages", async () => {
    expect([...(await filterReadablePages(prisma, outsider, all()))]).toContain(publicPage);
  });

  it("drops a private space's pages for a non-member", async () => {
    const readable = await filterReadablePages(prisma, outsider, all());
    expect([...readable]).not.toContain(privatePage);
  });

  it("keeps a private page the caller was granted explicitly", async () => {
    // The Notion rule: a page grant widens the baseline, it never narrows it.
    expect([...(await filterReadablePages(prisma, outsider, all()))]).toContain(grantedPage);
  });

  it("lets a member of the private space see it without a grant", async () => {
    expect([...(await filterReadablePages(prisma, member, all()))]).toContain(privatePage);
  });

  it("drops trashed pages and pages in a trashed space", async () => {
    const readable = await filterReadablePages(prisma, member, all());
    expect([...readable]).not.toContain(trashedPage);
    expect([...readable]).not.toContain(pageInTrashedSpace);
  });

  it("honours a level above VIEW", async () => {
    // The outsider's grant is VIEW; asking for EDIT must not return it.
    const editable = await filterReadablePages(prisma, outsider, all(), "EDIT");
    expect([...editable]).not.toContain(grantedPage);
    expect([...(await filterReadablePages(prisma, member, all(), "EDIT"))]).toContain(privatePage);
  });

  it("returns nothing for an empty input without querying", async () => {
    expect(await filterReadablePages(prisma, outsider, [])).toEqual(new Set());
  });
});
