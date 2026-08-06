import { createHash } from "node:crypto";
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Queue } from "bullmq";
import {
  getEffectivePageLevel,
  getEffectiveSpaceLevel,
  getPrisma,
  type Attachment,
  type SpaceVisibility,
} from "@angy/db";
import {
  JOB_ATTACHMENT_REINDEX,
  JOB_THUMBNAIL,
  ok,
  QUEUE_MAINTENANCE,
  satisfies,
  type ApiOk,
  type AttachmentDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { bareMediaUrl, mediaUrl, putMediaObject } from "../media";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { getRedis } from "../redis";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

let maintenance: Queue | undefined;

function maintenanceQueue(): Queue {
  maintenance ??= new Queue(QUEUE_MAINTENANCE, { connection: getRedis() });
  return maintenance;
}

async function toDto(
  attachment: Attachment & { page?: { title: string } | null },
  visibility: SpaceVisibility,
  uploaderName: string | null,
  usedOnPages: AttachmentDto["usedOnPages"] = [],
): Promise<AttachmentDto> {
  const isPrivate = visibility === "PRIVATE";
  return {
    id: attachment.id.toString(),
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
    width: attachment.width,
    height: attachment.height,
    sha256: attachment.sha256,
    pageId: attachment.pageId,
    pageTitle: attachment.page?.title ?? null,
    usedOnPages,
    uploadedByName: uploaderName,
    createdAt: attachment.createdAt.toISOString(),
    url: await mediaUrl(attachment.s3Key, isPrivate),
    thumbnailUrl: attachment.thumbnailS3Key
      ? await mediaUrl(attachment.thumbnailS3Key, isPrivate)
      : null,
    signed: isPrivate,
    docSrc: isPrivate ? `/media/${attachment.s3Key}` : bareMediaUrl(attachment.s3Key),
  };
}

@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class AttachmentsController {
  /** Upload media to a page. Content-addressed: media/{sha256}, deduplicated. */
  @Post("pages/:id/attachments")
  @RequirePageLevel("EDIT")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<AttachmentDto>> {
    if (!file) throw new BadRequestException("Attach a file under the 'file' field");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `${file.originalname} exceeded ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
      );
    }
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({
      where: { id, deletedAt: null },
      include: { space: true },
    });
    if (!page) throw new NotFoundException("Page not found");

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    // Access class is a storage prefix: only media/* has anonymous read.
    // media-private/* is reachable exclusively through signed URLs (ADR 0007).
    const prefix = page.space.visibility === "PRIVATE" ? "media-private" : "media";
    const s3Key = `${prefix}/${sha256}`;
    await putMediaObject(s3Key, file.buffer, file.mimetype);

    const attachment = await prisma.attachment.create({
      data: {
        pageId: page.id,
        fileName: file.originalname,
        sha256,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        s3Key,
        uploadedBy: req.user.id,
      },
    });
    if (file.mimetype.startsWith("image/")) {
      await maintenanceQueue().add(JOB_THUMBNAIL, { attachmentId: attachment.id.toString() });
    }
    await maintenanceQueue().add(JOB_ATTACHMENT_REINDEX, {
      attachmentId: attachment.id.toString(),
    });
    return ok(
      await toDto(attachment, page.space.visibility, req.user.displayName, [
        { id: page.id, title: page.title },
      ]),
    );
  }

  /** Space media library (frame 8): every live attachment on the space's pages. */
  @Get("spaces/:spaceId/attachments")
  async list(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<AttachmentDto[]>> {
    const prisma = getPrisma();
    const space = await prisma.space.findUnique({ where: { id: BigInt(spaceId) } });
    if (!space) throw new NotFoundException("Space not found");
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, space.id);
    if (!satisfies(level, "VIEW")) {
      throw new ForbiddenException("You don't have access to this space");
    }

    const attachments = await prisma.attachment.findMany({
      where: { deletedAt: null, page: { spaceId: space.id, deletedAt: null } },
      include: { page: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    });
    const uploaderIds = [...new Set(attachments.map((a) => a.uploadedBy))];
    const uploaders = await prisma.appUser.findMany({ where: { id: { in: uploaderIds } } });
    const nameOf = new Map(uploaders.map((u) => [u.id.toString(), u.displayName]));

    // One S3 object per sha256, one row per (page, upload) — so usage is the
    // set of pages sharing a hash. Space-scoped: page grants only widen, so
    // everyone who can read the space can read every page title in it.
    const usage = new Map<string, AttachmentDto["usedOnPages"]>();
    for (const attachment of attachments) {
      if (!attachment.page) continue;
      const pages = usage.get(attachment.sha256) ?? [];
      if (!pages.some((p) => p.id === attachment.page!.id)) {
        pages.push({ id: attachment.page.id, title: attachment.page.title });
      }
      usage.set(attachment.sha256, pages);
    }

    return ok(
      await Promise.all(
        attachments.map((a) =>
          toDto(
            a,
            space.visibility,
            nameOf.get(a.uploadedBy.toString()) ?? null,
            usage.get(a.sha256) ?? [],
          ),
        ),
      ),
    );
  }

  /** Soft delete — the 30-day GC sweep hard-deletes and cleans S3 (Phase 9). */
  @Delete("attachments/:attachmentId")
  async remove(
    @Param("attachmentId") attachmentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ deleted: true }>> {
    const prisma = getPrisma();
    const attachment = await prisma.attachment.findUnique({
      where: { id: BigInt(attachmentId) },
    });
    if (!attachment || attachment.deletedAt) throw new NotFoundException("Attachment not found");
    if (attachment.pageId) {
      const level = await getEffectivePageLevel(prisma, req.user.id, attachment.pageId);
      if (!satisfies(level, "EDIT")) {
        throw new ForbiddenException("You need edit access to delete attachments");
      }
    }
    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { deletedAt: new Date() },
    });
    // Soft-deleted files must leave search immediately, not at the 30-day sweep.
    await maintenanceQueue().add(JOB_ATTACHMENT_REINDEX, {
      attachmentId: attachment.id.toString(),
    });
    return ok({ deleted: true });
  }
}
