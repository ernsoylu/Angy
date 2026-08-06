import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import {
  grantWidensBaseline,
  ok,
  upsertGrantSchema,
  type ApiOk,
  type PagePermissionsDto,
  type UpsertGrantDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";
import { invalidatePagePermissions } from "../permissions/permissions.service";
import { ZodValidationPipe } from "../zod.pipe";

/** Share dialog backend (frame 7). Managing grants requires FULL access. */
@Controller("pages/:id/permissions")
@UseGuards(SessionGuard, PagePermissionGuard)
export class PagePermissionsController {
  @Get()
  @RequirePageLevel("FULL")
  async get(@Param("id") id: string): Promise<ApiOk<PagePermissionsDto>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({
      where: { id, deletedAt: null },
      include: {
        space: { include: { _count: { select: { members: true } } } },
        permissions: { include: { user: true }, orderBy: { grantedAt: "asc" } },
      },
    });
    if (!page) throw new NotFoundException("Page not found");
    const [owner, descendants] = await Promise.all([
      prisma.appUser.findUnique({ where: { id: page.createdBy } }),
      prisma.pageAncestor.count({ where: { ancestorId: id, NOT: { descendantId: id } } }),
    ]);
    return ok({
      space: {
        name: page.space.name,
        memberCount: page.space._count.members,
        baseline: page.space.defaultPermLevel,
        visibility: page.space.visibility,
      },
      owner: owner
        ? { id: owner.id.toString(), displayName: owner.displayName, email: owner.email }
        : null,
      grants: page.permissions
        .filter((grant) => grant.permLevel !== "ADMIN")
        .map((grant) => ({
          userId: grant.userId.toString(),
          displayName: grant.user.displayName,
          email: grant.user.email,
          level: grant.permLevel as "VIEW" | "EDIT" | "FULL",
        })),
      descendants,
    });
  }

  @Post()
  @RequirePageLevel("FULL")
  async upsert(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(upsertGrantSchema)) body: UpsertGrantDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ invalidated: number }>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");
    const user = await prisma.appUser.findUnique({ where: { email: body.email } });
    if (!user) throw new NotFoundException(`No account for ${body.email}`);

    const baseline = await getEffectiveSpaceLevel(prisma, user.id, page.spaceId);
    if (!grantWidensBaseline(body.level, baseline)) {
      throw new BadRequestException(
        "Page grants can only widen access. You cannot reduce someone's space-level access from this page.",
      );
    }

    await prisma.pagePermission.upsert({
      where: { pageId_userId: { pageId: id, userId: user.id } },
      update: { permLevel: body.level, grantedBy: req.user.id },
      create: { pageId: id, userId: user.id, permLevel: body.level, grantedBy: req.user.id },
    });
    const invalidated = await invalidatePagePermissions(id);
    return ok({ invalidated: invalidated.length });
  }

  @Delete(":userId")
  @RequirePageLevel("FULL")
  async remove(
    @Param("id") id: string,
    @Param("userId") userId: string,
  ): Promise<ApiOk<{ invalidated: number }>> {
    await getPrisma().pagePermission.deleteMany({
      where: { pageId: id, userId: BigInt(userId) },
    });
    const invalidated = await invalidatePagePermissions(id);
    return ok({ invalidated: invalidated.length });
  }
}
