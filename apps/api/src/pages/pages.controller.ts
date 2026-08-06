import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SignJWT } from "jose";
import { env } from "../env";
import { createPage, getBreadcrumb, getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import {
  createPageSchema,
  JOB_PROJECTION_INIT,
  JOB_PROJECTION_REBUILD,
  ok,
  renamePageSchema,
  satisfies,
  type ApiOk,
  type CreatePageDto,
  type PageDetailDto,
  type RenamePageDto,
} from "@angy/shared";
import { ForbiddenException } from "@nestjs/common";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { projectionsQueue } from "../queue";
import { ZodValidationPipe } from "../zod.pipe";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 60);
  return base || "page";
}

@Controller("pages")
@UseGuards(SessionGuard, PagePermissionGuard)
export class PagesController {
  @Get(":id")
  @RequirePageLevel("VIEW")
  async get(@Param("id") id: string): Promise<ApiOk<PageDetailDto>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
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
    return ok({
      id: page.id,
      spaceId: page.spaceId.toString(),
      parentId: page.parentId,
      title: page.title,
      slug: page.slug,
      renderedHtml: page.renderedHtml,
      breadcrumb: breadcrumb.map((row) => ({ id: row.id, title: row.title, slug: row.slug })),
      version: latestRevision?.version ?? null,
      updatedByName: editor?.displayName ?? null,
      contributors: Math.max(contributors.length, 1),
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    });
  }

  /**
   * Short-lived connect token for the realtime server (ADR 0008). Signed with
   * JWT_SECRET — scoped to one page, not a general credential.
   */
  @Get(":id/realtime-token")
  @RequirePageLevel("EDIT")
  async realtimeToken(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ token: string }>> {
    const page = await getPrisma().page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    const token = await new SignJWT({ page: id, name: req.user.displayName })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(req.user.id.toString())
      .setExpirationTime("15m")
      .setIssuedAt()
      .sign(new TextEncoder().encode(env.jwtSecret()));
    return ok({ token });
  }

  /** Rename — the slug stays stable so links keep working. */
  @Patch(":id")
  @RequirePageLevel("EDIT")
  async rename(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renamePageSchema)) body: RenamePageDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ title: string }>> {
    const page = await getPrisma().page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    await getPrisma().page.update({
      where: { id },
      data: { title: body.title, updatedBy: req.user.id },
    });
    // The title lives in projections and the search index too.
    await projectionsQueue().add(JOB_PROJECTION_REBUILD, { pageId: id });
    return ok({ title: body.title });
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createPageSchema)) body: CreatePageDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ id: string; slug: string }>> {
    const prisma = getPrisma();
    const spaceId = BigInt(body.spaceId);
    const spaceLevel = await getEffectiveSpaceLevel(prisma, req.user.id, spaceId);
    if (!satisfies(spaceLevel, "EDIT")) {
      throw new ForbiddenException("You need edit access to create pages in this space");
    }
    if (body.parentId) {
      const parent = await prisma.page.findFirst({
        where: { id: body.parentId, spaceId, deletedAt: null },
      });
      if (!parent) throw new NotFoundException("Parent page not found in this space");
    }

    const base = slugify(body.title);
    const taken = await prisma.page.findMany({
      where: { spaceId, slug: { startsWith: base } },
      select: { slug: true },
    });
    const slugs = new Set(taken.map((p) => p.slug));
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;

    const page = await createPage(prisma, {
      spaceId,
      parentId: body.parentId ?? null,
      title: body.title,
      slug,
      createdBy: req.user.id,
    });
    // The worker owns Y.Doc creation: builds the fresh doc, persists it to S3,
    // and generates the first projections (docs/implementation-plan.md § 3).
    await projectionsQueue().add(JOB_PROJECTION_INIT, { pageId: page.id });
    return ok({ id: page.id, slug: page.slug });
  }
}
