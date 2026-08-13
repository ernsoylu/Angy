import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getEffectiveSpaceLevel, getPrisma, type Prisma } from "@angy/db";
import {
  ok,
  saveTemplateSchema,
  satisfies,
  type ApiOk,
  type PageTemplateDto,
  type SaveTemplateDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { ZodValidationPipe } from "../zod.pipe";

/**
 * Page templates (V2 H2) — the thing that makes an empty workspace usable.
 *
 * A template is a snapshot of a page's `document_json`, not a live link to it:
 * editing the page it came from must not silently change what every future
 * page starts from. Re-saving over the same name is how a template is updated,
 * which is why the name is unique per space rather than free-form.
 *
 * Space-scoped, because permissions are. A workspace-wide template would need
 * its own answer to "who may edit this", and there is no workspace-settings
 * surface to put that on (the same gap tag admin already lives with).
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class TemplatesController {
  /** Templates available in this space. VIEW, because using one is not editing. */
  @Get("spaces/:spaceId/templates")
  async list(
    @Param("spaceId") spaceId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<PageTemplateDto[]>> {
    const prisma = getPrisma();
    const id = BigInt(spaceId);
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, id);
    if (!satisfies(level, "VIEW")) {
      throw new ForbiddenException("You don't have access to this space");
    }

    const templates = await prisma.pageTemplate.findMany({
      where: { spaceId: id, space: { deletedAt: null } },
      orderBy: { name: "asc" },
    });
    const authors = await prisma.appUser.findMany({
      where: { id: { in: [...new Set(templates.map((t) => t.createdBy))] } },
    });
    const nameOf = new Map(authors.map((u) => [u.id.toString(), u.displayName]));

    return ok(
      templates.map((template) => ({
        id: template.id.toString(),
        name: template.name,
        description: template.description,
        createdByName: nameOf.get(template.createdBy.toString()) ?? null,
        createdAt: template.createdAt.toISOString(),
      })),
    );
  }

  /**
   * Save this page's current body as a template.
   *
   * EDIT on the page, not ADMIN on the space: anyone who could have written the
   * page can offer its shape to others, and the content being saved is content
   * they already have. Re-using a name overwrites, so improving a template is
   * the same gesture as creating one.
   */
  @Post("pages/:id/save-as-template")
  @RequirePageLevel("EDIT")
  async save(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(saveTemplateSchema)) body: SaveTemplateDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ id: string; name: string }>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    if (!page.documentJson) {
      // The projection has not caught up yet, so there is nothing to snapshot.
      // Saving an empty template would be worse than refusing.
      throw new NotFoundException("This page has no content to save yet");
    }

    const template = await prisma.pageTemplate.upsert({
      where: { spaceId_name: { spaceId: page.spaceId, name: body.name } },
      create: {
        spaceId: page.spaceId,
        name: body.name,
        description: body.description ?? null,
        documentJson: page.documentJson as Prisma.InputJsonValue,
        createdBy: req.user.id,
      },
      update: {
        description: body.description ?? null,
        documentJson: page.documentJson as Prisma.InputJsonValue,
        createdBy: req.user.id,
      },
    });
    return ok({ id: template.id.toString(), name: template.name });
  }

  /** Remove a template. ADMIN, because it is shared by the whole space. */
  @Delete("templates/:templateId")
  async remove(
    @Param("templateId") templateId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ deleted: true }>> {
    const prisma = getPrisma();
    const template = await prisma.pageTemplate.findUnique({
      where: { id: BigInt(templateId) },
    });
    if (!template) throw new NotFoundException("Template not found");
    const level = await getEffectiveSpaceLevel(prisma, req.user.id, template.spaceId);
    if (!satisfies(level, "ADMIN")) {
      throw new ForbiddenException("Only a space admin can delete a template");
    }
    await prisma.pageTemplate.delete({ where: { id: template.id } });
    return ok({ deleted: true });
  }
}

/**
 * The body a new page should start from, or null for an empty document.
 *
 * Lives here rather than in the page controller so the template's own rules —
 * it must exist, and it must belong to the space being written to — stay next
 * to the rest of the template code. A template from another space would be a
 * cross-space content copy that no permission check covered.
 */
export async function templateBody(
  spaceId: bigint,
  templateId: string | null | undefined,
): Promise<Prisma.InputJsonValue | undefined> {
  if (!templateId) return undefined;
  const template = await getPrisma().pageTemplate.findUnique({
    where: { id: BigInt(templateId) },
  });
  if (!template || template.spaceId !== spaceId) {
    throw new NotFoundException("Template not found in this space");
  }
  return template.documentJson as Prisma.InputJsonValue;
}
