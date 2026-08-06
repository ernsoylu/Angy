import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Queue } from "bullmq";
import {
  getEffectivePageLevel,
  getEffectiveSpaceLevel,
  getPrisma,
  movePage,
  PageMoveError,
  restorePage,
  trashPage,
} from "@angy/db";
import {
  JOB_GC_PAGE,
  JOB_MEDIA_REEMIT,
  JOB_PROJECTION_REBUILD,
  movePageSchema,
  ok,
  QUEUE_MAINTENANCE,
  satisfies,
  type ApiOk,
  type MovePageDto,
  type TrashItemDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { invalidatePagePermissions } from "../permissions/permissions.service";
import { projectionsQueue } from "../queue";
import { getRedis } from "../redis";
import { ZodValidationPipe } from "../zod.pipe";

const RETENTION_MS = Number(process.env.TRASH_RETENTION_MS ?? 30 * 24 * 60 * 60 * 1000);

let maintenance: Queue | undefined;

function maintenanceQueue(): Queue {
  maintenance ??= new Queue(QUEUE_MAINTENANCE, { connection: getRedis() });
  return maintenance;
}

async function enqueueRebuilds(pageIds: string[]): Promise<void> {
  for (const pageId of pageIds) {
    await projectionsQueue().add(JOB_PROJECTION_REBUILD, { pageId });
  }
}

@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class PageOpsController {
  /** Move a page (and its subtree) — advisory-locked closure rewrite; cross-space allowed. */
  @Post("pages/:id/move")
  @RequirePageLevel("EDIT")
  async move(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(movePageSchema)) body: MovePageDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ moved: true }>> {
    const prisma = getPrisma();

    // Moving INTO a space needs edit rights there, not just on the page.
    let targetSpaceId: bigint;
    if (body.parentId) {
      const parent = await prisma.page.findFirst({
        where: { id: body.parentId, deletedAt: null },
      });
      if (!parent) throw new NotFoundException("Destination page not found");
      targetSpaceId = parent.spaceId;
    } else if (body.spaceId) {
      targetSpaceId = BigInt(body.spaceId);
    } else {
      const page = await prisma.page.findUnique({ where: { id } });
      if (!page) throw new NotFoundException("Page not found");
      targetSpaceId = page.spaceId;
    }
    const targetLevel = await getEffectiveSpaceLevel(prisma, req.user.id, targetSpaceId);
    if (!satisfies(targetLevel, "EDIT")) {
      throw new ForbiddenException("You need edit access in the destination space");
    }

    let result;
    try {
      result = await movePage(prisma, id, body.parentId, targetSpaceId);
    } catch (err) {
      if (err instanceof PageMoveError) throw new BadRequestException(err.message);
      throw err;
    }
    // Permissions and search both depend on the ancestor chain.
    await invalidatePagePermissions(id);
    await enqueueRebuilds(result.movedIds);
    // Crossing a visibility class re-emits media URL forms (ADR 0007).
    if (result.visibilityChanged) {
      for (const pageId of result.movedIds) {
        await maintenanceQueue().add(JOB_MEDIA_REEMIT, { pageId });
      }
    }
    return ok({ moved: true });
  }

  /** Soft-delete into the 30-day trash. */
  @Post("pages/:id/trash")
  @RequirePageLevel("EDIT")
  async trash(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ trashed: number }>> {
    const ids = await trashPage(getPrisma(), id, req.user.id);
    await invalidatePagePermissions(id);
    await enqueueRebuilds(ids);
    return ok({ trashed: ids.length });
  }

  /** Restore a trashed subtree — its place in the tree was kept. */
  @Post("pages/:id/restore")
  async restore(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ restored: number }>> {
    const level = await getEffectivePageLevel(getPrisma(), req.user.id, id);
    if (!satisfies(level, "EDIT")) {
      throw new ForbiddenException("You need edit access to restore this page");
    }
    const ids = await restorePage(getPrisma(), id);
    await invalidatePagePermissions(id);
    await enqueueRebuilds(ids);
    return ok({ restored: ids.length });
  }

  /** Immediate hard delete ("Delete now") — skips the 30-day wait. */
  @Post("pages/:id/hard-delete")
  async hardDelete(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ queued: true }>> {
    const prisma = getPrisma();
    const page = await prisma.page.findUnique({ where: { id } });
    if (!page || !page.deletedAt) throw new NotFoundException("Page is not in the trash");
    const level = await getEffectivePageLevel(prisma, req.user.id, id);
    if (!satisfies(level, "FULL")) {
      throw new ForbiddenException("Full access is required to delete permanently");
    }
    await maintenanceQueue().add(JOB_GC_PAGE, { pageId: id });
    return ok({ queued: true });
  }

  /** Trash listing (frame 9): roots of trashed subtrees, most urgent first. */
  @Get("spaces/:spaceId/trash")
  async list(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<TrashItemDto[]>> {
    const prisma = getPrisma();
    const space = await prisma.space.findUnique({ where: { id: BigInt(spaceId) } });
    if (!space) throw new NotFoundException("Space not found");
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, space.id);
    if (!satisfies(level, "VIEW")) {
      throw new ForbiddenException("You don't have access to this space");
    }

    const pages = await prisma.page.findMany({
      where: {
        spaceId: space.id,
        deletedAt: { not: null },
        OR: [{ parentId: null }, { parent: { deletedAt: null } }],
      },
      include: { parent: { select: { title: true } } },
      orderBy: { deletedAt: "asc" },
    });
    const actorIds = [...new Set(pages.map((p) => p.updatedBy ?? p.createdBy))];
    const actors = await prisma.appUser.findMany({ where: { id: { in: actorIds } } });
    const nameOf = new Map(actors.map((u) => [u.id.toString(), u.displayName]));

    return ok(
      pages.map((p) => ({
        id: p.id,
        title: p.title,
        parentTitle: p.parent?.title ?? null,
        spaceName: space.name,
        trashedByName: nameOf.get((p.updatedBy ?? p.createdBy).toString()) ?? null,
        deletedAt: p.deletedAt!.toISOString(),
        hardDeleteAt: new Date(p.deletedAt!.getTime() + RETENTION_MS).toISOString(),
      })),
    );
  }
}
