import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import {
  importMarkdownSchema,
  ok,
  satisfies,
  type ApiOk,
  type ImportMarkdownDto,
  type ImportResultDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../zod.pipe";
import { normaliseArchivePath, unpackArchive } from "./archive";
import { importBundle } from "./import.service";

/** Compressed bytes on the wire; `unpackArchive` owns the inflated bound. */
const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024;

/**
 * Markdown import (ADR 0005, the one-directional *in* flow) in its two forms.
 *
 * `POST /spaces/:id/import` takes a generic bundle of `{path, markdown}`. It is
 * the engine, and it stays generic on purpose: the server learns one shape
 * rather than one format per vendor.
 *
 * `POST /spaces/:id/import/archive` takes the `.zip` a person actually has in
 * their downloads folder, unpacks it into that same bundle, and carries the
 * media along so an imported page's images are Angy attachments rather than
 * references to a folder that no longer exists.
 *
 * The API is CommonJS and must never construct a Y.Doc (CLAUDE.md gotcha), and
 * it does not need to — the import produces plain JSON and the worker turns it
 * into a document.
 */
@Controller()
@UseGuards(SessionGuard)
export class ImportController {
  @Post("spaces/:spaceId/import")
  async importMarkdown(
    @Param("spaceId") spaceId: string,
    @Body(new ZodValidationPipe(importMarkdownSchema)) body: ImportMarkdownDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<ImportResultDto>> {
    const space = await this.writableSpace(spaceId, req);
    return ok(
      await importBundle(getPrisma(), {
        spaceId: space.id,
        spaceVisibility: space.visibility,
        userId: req.user.id,
        files: body.files.map((file) => ({
          path: normaliseArchivePath(file.path),
          markdown: file.markdown,
        })),
      }),
    );
  }

  /**
   * Unpacking happens in the request, like the bundle import it delegates to.
   * The work is bounded before it starts — the archive's own headers say how
   * much it inflates to, and `unpackArchive` refuses anything past the limit —
   * and the person who chose the file is waiting for the list of what became a
   * page and what did not. A queued job would have to invent somewhere to put
   * that answer.
   */
  @Post("spaces/:spaceId/import/archive")
  // Multer's own ceiling sits just above the checked one, so an ordinary
  // oversize archive gets the message below and a pathological upload is cut
  // off at the socket instead of being buffered into the API's heap.
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_ARCHIVE_BYTES + 1024 * 1024 } }),
  )
  async importArchive(
    @Param("spaceId") spaceId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<ImportResultDto>> {
    if (!file) throw new BadRequestException("Attach the export archive under the 'file' field");
    if (file.size > MAX_ARCHIVE_BYTES) {
      throw new BadRequestException(
        `That archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB — split the export`,
      );
    }
    const space = await this.writableSpace(spaceId, req);

    const archive = unpackArchive(file.buffer);
    if (archive.files.length === 0) {
      throw new BadRequestException(
        "No Markdown files in that archive — export as Markdown, not HTML or PDF",
      );
    }

    return ok(
      await importBundle(getPrisma(), {
        spaceId: space.id,
        spaceVisibility: space.visibility,
        userId: req.user.id,
        files: archive.files,
        media: archive.media,
        skipped: archive.skipped,
      }),
    );
  }

  /** Import writes pages, so it needs what writing a page needs. */
  private async writableSpace(spaceId: string, req: AuthedRequest) {
    const prisma = getPrisma();
    const space = await prisma.space.findFirst({
      where: { id: BigInt(spaceId), deletedAt: null },
    });
    if (!space) throw new NotFoundException("Space not found");
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, space.id);
    if (!satisfies(level, "EDIT")) {
      throw new ForbiddenException("You need edit access to import into this space");
    }
    return space;
  }
}
