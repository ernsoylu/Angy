import "server-only";
import { config } from "dotenv";
import { getBreadcrumb, getEffectivePageLevel, getPrisma } from "@angy/db";
import { satisfies, type PermLevelDto } from "@angy/shared";

// The read path (CLAUDE.md): RSC streams rendered_html from Postgres directly —
// no API hop for page content. Auth and the page tree stay on the REST API.
config({ path: `${process.cwd()}/../../.env.local`, quiet: true });

export interface ReaderPage {
  id: string;
  title: string;
  renderedHtml: string | null;
  breadcrumb: { id: string; title: string }[];
  version: number | null;
  updatedByName: string | null;
  contributors: number;
  updatedAt: string;
}

/**
 * Load a page for the read path, enforcing the caller's effective permission
 * (space baseline ∪ page grants). "forbidden" renders the restricted state.
 */
export async function getReaderPage(
  pageId: string,
  userId: bigint,
  required: PermLevelDto = "VIEW",
): Promise<ReaderPage | "forbidden" | null> {
  if (!/^[0-9a-f-]{36}$/.test(pageId)) return null;
  const prisma = getPrisma();
  const page = await prisma.page.findFirst({ where: { id: pageId, deletedAt: null } });
  if (!page) return null;
  const level = await getEffectivePageLevel(prisma, userId, pageId);
  if (!satisfies(level, required)) return "forbidden";

  const [breadcrumb, latestRevision, contributors, editor] = await Promise.all([
    getBreadcrumb(prisma, page.id),
    prisma.pageRevision.findFirst({ where: { pageId: page.id }, orderBy: { version: "desc" } }),
    prisma.pageRevision.findMany({
      where: { pageId: page.id },
      distinct: ["createdBy"],
      select: { createdBy: true },
    }),
    prisma.appUser.findUnique({ where: { id: page.updatedBy ?? page.createdBy } }),
  ]);

  return {
    id: page.id,
    title: page.title,
    renderedHtml: page.renderedHtml,
    breadcrumb: breadcrumb.map((row) => ({ id: row.id, title: row.title })),
    version: latestRevision?.version ?? null,
    updatedByName: editor?.displayName ?? null,
    contributors: Math.max(contributors.length, 1),
    updatedAt: page.updatedAt.toISOString(),
  };
}
