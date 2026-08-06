import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import { ok, satisfies, type ApiOk, type PageListItemDto } from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";

const LIST_LIMIT = 20;

type PageRow = {
  id: string;
  title: string;
  parent: { title: string } | null;
  updatedBy: bigint | null;
  createdBy: bigint;
};

async function toListItems(
  rows: { page: PageRow; at: Date }[],
): Promise<PageListItemDto[]> {
  const editorIds = [...new Set(rows.map((r) => r.page.updatedBy ?? r.page.createdBy))];
  const editors = await getPrisma().appUser.findMany({ where: { id: { in: editorIds } } });
  const nameOf = new Map(editors.map((u) => [u.id.toString(), u.displayName]));
  return rows.map(({ page, at }) => ({
    id: page.id,
    title: page.title,
    parentTitle: page.parent?.title ?? null,
    at: at.toISOString(),
    updatedByName: nameOf.get((page.updatedBy ?? page.createdBy).toString()) ?? null,
  }));
}

const PAGE_SELECT = {
  id: true,
  title: true,
  updatedBy: true,
  createdBy: true,
  parent: { select: { title: true } },
} as const;

/**
 * Per-user page state: stars, plus the Recent/Starred lists behind the sidebar.
 * Both models are keyed by (user, page) and read back scoped to a space,
 * because the sidebar that renders them is space-scoped.
 *
 * Visits are *written* on the reader's RSC render through `recordPageVisit`
 * (packages/db) rather than an endpoint here — the read path talks to Postgres
 * directly and shouldn't grow an HTTP hop.
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class PersonalController {
  @Put("pages/:id/star")
  @RequirePageLevel("VIEW")
  async star(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ starred: true }>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    await prisma.pageStar.upsert({
      where: { userId_pageId: { userId: req.user.id, pageId: id } },
      create: { userId: req.user.id, pageId: id },
      update: {},
    });
    return ok({ starred: true });
  }

  @Delete("pages/:id/star")
  @RequirePageLevel("VIEW")
  async unstar(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ starred: false }>> {
    await getPrisma().pageStar.deleteMany({ where: { userId: req.user.id, pageId: id } });
    return ok({ starred: false });
  }

  /** Recently read pages in this space, most recent first. */
  @Get("spaces/:spaceId/recent")
  async recent(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PageListItemDto[]>> {
    const rows = await this.listFor(spaceId, req, "recent");
    return ok(rows);
  }

  /** Starred pages in this space, most recently starred first. */
  @Get("spaces/:spaceId/starred")
  async starred(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PageListItemDto[]>> {
    const rows = await this.listFor(spaceId, req, "starred");
    return ok(rows);
  }

  private async listFor(
    spaceId: string,
    req: AuthedRequest,
    kind: "recent" | "starred",
  ): Promise<PageListItemDto[]> {
    const prisma = getPrisma();
    const id = BigInt(spaceId);
    // Space VIEW is the whole check: page grants only widen (Notion rule), so
    // anyone who can read the space can read every page in it.
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, id);
    if (!satisfies(level, "VIEW")) {
      throw new ForbiddenException("You don't have access to this space");
    }

    const where = { userId: req.user.id, page: { spaceId: id, deletedAt: null } };
    if (kind === "recent") {
      const visits = await prisma.pageVisit.findMany({
        where,
        orderBy: { visitedAt: "desc" },
        take: LIST_LIMIT,
        select: { visitedAt: true, page: { select: PAGE_SELECT } },
      });
      return toListItems(visits.map((v) => ({ page: v.page, at: v.visitedAt })));
    }
    const stars = await prisma.pageStar.findMany({
      where,
      orderBy: { starredAt: "desc" },
      take: LIST_LIMIT,
      select: { starredAt: true, page: { select: PAGE_SELECT } },
    });
    return toListItems(stars.map((s) => ({ page: s.page, at: s.starredAt })));
  }
}
