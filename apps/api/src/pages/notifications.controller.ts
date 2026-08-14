import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { filterReadablePages, getPrisma } from "@angy/db";
import { ok, type ApiOk, type NotificationDto } from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";

/** An inbox is a glance, not an archive. */
const INBOX_LIMIT = 30;

/**
 * The in-app inbox (V2 H3) — raised by the projection worker when a page names
 * you, read here.
 *
 * Filtered by read access at *serve* time rather than at raise time. Access
 * can be revoked after a notification exists, and an inbox row carries a page
 * title, so re-checking on read is what stops a withdrawn page staying visible
 * in someone's bell menu forever. The rows are left in place: an inbox records
 * that something happened, and losing access does not un-happen it.
 */
@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  @Get()
  async list(@Req() req: AuthedRequest): Promise<ApiOk<NotificationDto[]>> {
    const prisma = getPrisma();
    const rows = await prisma.notification.findMany({
      where: { userId: req.user.id, page: { deletedAt: null, space: { deletedAt: null } } },
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: INBOX_LIMIT,
      include: { page: { select: { id: true, title: true, space: { select: { key: true } } } } },
    });

    const readable = await filterReadablePages(
      prisma,
      req.user.id,
      rows.map((row) => row.pageId),
    );
    const visible = rows.filter((row) => readable.has(row.pageId));

    const actorIds = [...new Set(visible.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const actors =
      actorIds.length === 0
        ? []
        : await prisma.appUser.findMany({ where: { id: { in: actorIds } } });
    const nameOf = new Map(actors.map((u) => [u.id.toString(), u.displayName]));

    return ok(
      visible.map((row) => ({
        id: row.id.toString(),
        kind: row.kind,
        pageId: row.pageId,
        pageTitle: row.page.title,
        spaceKey: row.page.space.key,
        actorName: row.actorId ? (nameOf.get(row.actorId.toString()) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
      })),
    );
  }

  /** Mark everything read — the gesture the bell's badge actually needs. */
  @Post("read")
  async readAll(@Req() req: AuthedRequest): Promise<ApiOk<{ read: number }>> {
    const result = await getPrisma().notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ read: result.count });
  }

  /** Mark one read, so opening a single item does not clear the rest. */
  @Post(":id/read")
  async readOne(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ read: true }>> {
    // updateMany with the user in the filter: `update` on the id alone would
    // let anyone mark someone else's notification read.
    await getPrisma().notification.updateMany({
      where: { id: BigInt(id), userId: req.user.id },
      data: { readAt: new Date() },
    });
    return ok({ read: true });
  }
}
