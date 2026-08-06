import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { updateToJson, type JSONContent } from "@angy/blocks";
import { getPrisma } from "@angy/db";
import {
  DOC_COMMAND_CHANNEL,
  JOB_REVISION_CHECKPOINT,
  ok,
  QUEUE_MAINTENANCE,
  type ApiOk,
  type RestoreCommand,
  type RevisionDto,
} from "@angy/shared";
import { Queue } from "bullmq";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { getRedis } from "../redis";
import { getObject } from "../s3";

let maintenance: Queue | undefined;

function maintenanceQueue(): Queue {
  maintenance ??= new Queue(QUEUE_MAINTENANCE, { connection: getRedis() });
  return maintenance;
}

/** Revision history (frame 4, ADR 0006): full-state blobs, forward-only restore. */
@Controller("pages/:id/revisions")
@UseGuards(SessionGuard, PagePermissionGuard)
export class RevisionsController {
  @Get()
  @RequirePageLevel("VIEW")
  async list(@Param("id") id: string): Promise<ApiOk<RevisionDto[]>> {
    const prisma = getPrisma();
    const revisions = await prisma.pageRevision.findMany({
      where: { pageId: id },
      orderBy: { version: "desc" },
    });
    const authorIds = [...new Set(revisions.map((r) => r.createdBy))];
    const authors = await prisma.appUser.findMany({ where: { id: { in: authorIds } } });
    const nameOf = new Map(authors.map((u) => [u.id.toString(), u.displayName]));
    const latest = revisions[0]?.version;
    return ok(
      revisions.map((r) => ({
        version: r.version,
        label: r.label,
        authorName: nameOf.get(r.createdBy.toString()) ?? null,
        current: r.version === latest,
        sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }

  /** Materialize a revision's ProseMirror JSON for the diff view. */
  @Get(":version")
  @RequirePageLevel("VIEW")
  async content(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
  ): Promise<ApiOk<{ version: number; documentJson: JSONContent }>> {
    const revision = await getPrisma().pageRevision.findUnique({
      where: { pageId_version: { pageId: id, version } },
    });
    if (!revision) throw new NotFoundException("Revision not found");
    const bytes = await getObject(revision.revisionS3Key);
    if (!bytes) throw new NotFoundException("Revision blob is missing");
    return ok({ version, documentJson: updateToJson(bytes) });
  }

  /** Explicit save checkpoint — the Done button. */
  @Post()
  @RequirePageLevel("EDIT")
  async checkpoint(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ queued: true }>> {
    await maintenanceQueue().add(JOB_REVISION_CHECKPOINT, {
      pageId: id,
      createdBy: req.user.id.toString(),
    });
    return ok({ queued: true });
  }

  /** Non-destructive restore: v(old) is re-applied as the newest version. */
  @Post(":version/restore")
  @RequirePageLevel("EDIT")
  async restore(
    @Param("id") id: string,
    @Param("version", ParseIntPipe) version: number,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ restoring: number }>> {
    const revision = await getPrisma().pageRevision.findUnique({
      where: { pageId_version: { pageId: id, version } },
    });
    if (!revision) throw new NotFoundException("Revision not found");
    const command: RestoreCommand = {
      type: "restore",
      pageId: id,
      version,
      userId: req.user.id.toString(),
    };
    await getRedis().publish(DOC_COMMAND_CHANNEL, JSON.stringify(command));
    return ok({ restoring: version });
  }
}
