import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import {
  JOB_SEARCH_REINDEX,
  mergeTagSchema,
  normalizeTag,
  normalizeTags,
  ok,
  renameTagSchema,
  satisfies,
  setPageTagsSchema,
  type ApiOk,
  type MergeTagDto,
  type RenameTagDto,
  type SetPageTagsDto,
  type TagDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { projectionsQueue } from "../queue";
import { ZodValidationPipe } from "../zod.pipe";

const SUGGEST_LIMIT = 20;

async function reindex(pageIds: string[]): Promise<void> {
  const queue = projectionsQueue();
  await Promise.all(
    pageIds.map((pageId) => queue.add(JOB_SEARCH_REINDEX, { pageId })),
  );
}

/**
 * Tags (Wave D). Freeform to write — anyone with EDIT on a page can coin one —
 * and workspace-wide, so the name is the identity everywhere. Renaming and
 * merging are the cleanup half of that bargain and are deliberately narrow:
 * you may only reshape a tag whose entire footprint you administer.
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class TagsController {
  /** Typeahead for the assignment UI, most-used first. */
  @Get("tags")
  async list(
    @Query("q") q: string | undefined,
    @Req() _req: AuthedRequest,
  ): Promise<ApiOk<TagDto[]>> {
    const prisma = getPrisma();
    const query = q ? normalizeTag(q) : null;
    const tags = await prisma.tag.findMany({
      where: query ? { name: { contains: query } } : undefined,
      include: { _count: { select: { pages: true } } },
      orderBy: [{ pages: { _count: "desc" } }, { name: "asc" }],
      take: SUGGEST_LIMIT,
    });
    return ok(
      tags.map((tag) => ({
        id: tag.id.toString(),
        name: tag.name,
        pageCount: tag._count.pages,
      })),
    );
  }

  @Get("pages/:id/tags")
  @RequirePageLevel("VIEW")
  async forPage(@Param("id") id: string): Promise<ApiOk<TagDto[]>> {
    const rows = await getPrisma().pageTag.findMany({
      where: { pageId: id },
      include: { tag: { include: { _count: { select: { pages: true } } } } },
      orderBy: { addedAt: "asc" },
    });
    return ok(
      rows.map((row) => ({
        id: row.tag.id.toString(),
        name: row.tag.name,
        pageCount: row.tag._count.pages,
      })),
    );
  }

  /** Replace a page's tags. Unknown names are created on the spot (freeform). */
  @Put("pages/:id/tags")
  @RequirePageLevel("EDIT")
  async setForPage(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setPageTagsSchema)) body: SetPageTagsDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<TagDto[]>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    const names = normalizeTags(body.tags);

    await prisma.$transaction(async (tx) => {
      // Coin anything new. createMany + skipDuplicates keeps two editors
      // tagging the same word at once from colliding on the unique index.
      if (names.length > 0) {
        await tx.tag.createMany({
          data: names.map((name) => ({ name, createdBy: req.user.id })),
          skipDuplicates: true,
        });
      }
      const tags = await tx.tag.findMany({ where: { name: { in: names } } });
      await tx.pageTag.deleteMany({
        where: { pageId: id, tagId: { notIn: tags.map((t) => t.id) } },
      });
      if (tags.length > 0) {
        await tx.pageTag.createMany({
          data: tags.map((tag) => ({ pageId: id, tagId: tag.id, addedBy: req.user.id })),
          skipDuplicates: true,
        });
      }
    });

    await reindex([id]);
    return this.forPage(id);
  }

  /**
   * Rename a tag everywhere. Requires ADMIN on every space the tag appears in:
   * the name is shared workspace-wide, so anything less would let one space's
   * admin rewrite a label another space depends on.
   */
  @Post("tags/:tagId/rename")
  async rename(
    @Param("tagId") tagId: string,
    @Body(new ZodValidationPipe(renameTagSchema)) body: RenameTagDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<TagDto>> {
    const prisma = getPrisma();
    const name = normalizeTag(body.name);
    if (!name) throw new BadRequestException("That name has no usable characters");

    const tag = await prisma.tag.findUnique({ where: { id: BigInt(tagId) } });
    if (!tag) throw new NotFoundException("Tag not found");
    const pageIds = await this.assertAdminEverywhere(tag.id, req.user.id);

    const existing = await prisma.tag.findUnique({ where: { name } });
    if (existing && existing.id !== tag.id) {
      throw new BadRequestException(
        `"${name}" already exists — merge into it instead of renaming`,
      );
    }
    const updated = await prisma.tag.update({ where: { id: tag.id }, data: { name } });
    await reindex(pageIds);
    return ok({ id: updated.id.toString(), name: updated.name, pageCount: pageIds.length });
  }

  /** Fold one tag into another; the source disappears. Same authz as rename. */
  @Post("tags/:tagId/merge")
  async merge(
    @Param("tagId") tagId: string,
    @Body(new ZodValidationPipe(mergeTagSchema)) body: MergeTagDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<TagDto>> {
    const prisma = getPrisma();
    const sourceId = BigInt(tagId);
    const targetId = BigInt(body.intoId);
    if (sourceId === targetId) throw new BadRequestException("A tag cannot merge into itself");

    const [source, target] = await Promise.all([
      prisma.tag.findUnique({ where: { id: sourceId } }),
      prisma.tag.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) throw new NotFoundException("Tag not found");
    // Both footprints change, so both must be fully administered by the caller.
    const [sourcePages, targetPages] = await Promise.all([
      this.assertAdminEverywhere(sourceId, req.user.id),
      this.assertAdminEverywhere(targetId, req.user.id),
    ]);

    await prisma.$transaction(async (tx) => {
      await tx.pageTag.createMany({
        data: sourcePages.map((pageId) => ({ pageId, tagId: targetId, addedBy: req.user.id })),
        skipDuplicates: true,
      });
      await tx.tag.delete({ where: { id: sourceId } }); // cascades page_tag
    });

    const affected = [...new Set([...sourcePages, ...targetPages])];
    await reindex(affected);
    const pageCount = await prisma.pageTag.count({ where: { tagId: targetId } });
    return ok({ id: target.id.toString(), name: target.name, pageCount });
  }

  /**
   * @returns every live page carrying the tag, after proving the caller is an
   * ADMIN of each space involved.
   */
  private async assertAdminEverywhere(tagId: bigint, userId: bigint): Promise<string[]> {
    const prisma = getPrisma();
    const rows = await prisma.pageTag.findMany({
      where: { tagId, page: { deletedAt: null } },
      select: { pageId: true, page: { select: { spaceId: true } } },
    });
    const spaceIds = [...new Set(rows.map((row) => row.page.spaceId))];
    for (const spaceId of spaceIds) {
      const level = await getEffectiveSpaceLevel(prisma, userId, spaceId);
      if (!satisfies(level, "ADMIN")) {
        throw new ForbiddenException(
          "Tags are workspace-wide — you need admin on every space using this tag",
        );
      }
    }
    return rows.map((row) => row.pageId);
  }
}
