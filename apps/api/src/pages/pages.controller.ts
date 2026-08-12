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
import {
  createPage,
  getBacklinks,
  getBreadcrumb,
  getEffectivePageLevel,
  getEffectiveSpaceLevel,
  getPrisma,
} from "@angy/db";
import {
  createChildPageSchema,
  createPageSchema,
  DOC_COMMAND_CHANNEL,
  JOB_PROJECTION_INIT,
  ok,
  renamePageSchema,
  satisfies,
  type ApiOk,
  type BacklinkDto,
  type CreateChildPageDto,
  type CreatePageDto,
  type PageDetailDto,
  type RenameCommand,
  type RenamePageDto,
} from "@angy/shared";
import { ForbiddenException } from "@nestjs/common";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { checkPagePermission } from "../permissions/permissions.service";
import { projectionsQueue } from "../queue";
import { getRedis } from "../redis";
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
  async get(@Param("id") id: string, @Req() req: AuthedRequest): Promise<ApiOk<PageDetailDto>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    const [breadcrumb, latestRevision, contributors, editor, star] = await Promise.all([
      getBreadcrumb(prisma, page.id),
      prisma.pageRevision.findFirst({ where: { pageId: page.id }, orderBy: { version: "desc" } }),
      prisma.pageRevision.findMany({
        where: { pageId: page.id },
        distinct: ["createdBy"],
        select: { createdBy: true },
      }),
      prisma.appUser.findUnique({ where: { id: page.updatedBy ?? page.createdBy } }),
      prisma.pageStar.findUnique({
        where: { userId_pageId: { userId: req.user.id, pageId: page.id } },
      }),
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
      starred: star !== null,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    });
  }

  /**
   * Which pages link here (V2 H1) — served from `block_index`, the projection
   * the worker rebuilds alongside rendered_html.
   *
   * Filtered by the caller's read access, one check per referring page: a
   * backlink names a page and its title, so returning one the user cannot open
   * would leak both. VIEW on the target is not enough to see who points at it.
   *
   * Unpaginated deliberately for now — inbound links are naturally few, and the
   * bitmap check is a Redis lookup. If a hub page ever accumulates hundreds,
   * the UI that surfaces them (H3) is where a limit belongs, so it can say it
   * truncated rather than the API doing it silently.
   */
  @Get(":id/backlinks")
  @RequirePageLevel("VIEW")
  async backlinks(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<BacklinkDto[]>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");

    const candidates = await getBacklinks(prisma, id);
    const visible = await Promise.all(
      candidates.map((link) => checkPagePermission(req.user.id, link.pageId, "VIEW")),
    );
    return ok(
      candidates
        .filter((_link, i) => visible[i])
        .map((link) => ({
          id: link.pageId,
          spaceId: link.spaceId.toString(),
          title: link.title,
          slug: link.slug,
          count: link.count,
        })),
    );
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

  /**
   * Rename — the slug stays stable so links keep working.
   *
   * The title is a collaborative field in the page's Y.Doc (Wave F), so this
   * cannot write `page.title`: the next store would copy the doc's older title
   * back over it. Instead it publishes a doc command; realtime applies the edit
   * and `onStoreDocument` updates the row ~2s later, exactly like a keystroke
   * in the editor. Accepted, not applied — the response echoes the request.
   *
   * (The API is CommonJS and must never construct a Y.Doc — CLAUDE.md gotcha.)
   */
  @Patch(":id")
  @RequirePageLevel("EDIT")
  async rename(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renamePageSchema)) body: RenamePageDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ title: string }>> {
    const page = await getPrisma().page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    const command: RenameCommand = {
      type: "rename",
      pageId: id,
      title: body.title,
      userId: req.user.id.toString(),
    };
    await getRedis().publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
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

  /**
   * Create a child of an existing page — the `/page` slash command.
   *
   * Separate from POST /pages because the caller is the editor, which knows
   * only which page it is editing. Taking a spaceId from it would mean
   * threading one through the editor purely to hand it back, and would let a
   * malformed client ask for a child in a space its parent does not live in.
   * A child always belongs to its parent's space, so the server derives it.
   */
  @Post(":id/children")
  async createChild(
    @Param("id") parentId: string,
    @Body(new ZodValidationPipe(createChildPageSchema)) body: CreateChildPageDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ id: string; slug: string; title: string }>> {
    const prisma = getPrisma();
    const parent = await prisma.page.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true, spaceId: true },
    });
    if (!parent) throw new NotFoundException("Page not found");

    // EDIT on the parent, not merely on the space: page grants only ever widen
    // the space baseline, so the parent is the stricter and correct gate.
    const level = await getEffectivePageLevel(prisma, req.user.id, parent.id);
    if (!satisfies(level, "EDIT")) {
      throw new ForbiddenException("You need edit access to this page to add a child");
    }

    const base = slugify(body.title);
    const taken = await prisma.page.findMany({
      where: { spaceId: parent.spaceId, slug: { startsWith: base } },
      select: { slug: true },
    });
    const slugs = new Set(taken.map((p) => p.slug));
    let slug = base;
    for (let i = 2; slugs.has(slug); i++) slug = `${base}-${i}`;

    const page = await createPage(prisma, {
      spaceId: parent.spaceId,
      parentId: parent.id,
      title: body.title,
      slug,
      createdBy: req.user.id,
    });
    await projectionsQueue().add(JOB_PROJECTION_INIT, { pageId: page.id });
    return ok({ id: page.id, slug: page.slug, title: body.title });
  }
}
