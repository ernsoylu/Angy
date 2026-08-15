import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { getEffectiveSpaceLevel, getPrisma } from "@angy/db";
import {
  createSpaceSchema,
  JOB_SPACE_REINDEX,
  ok,
  QUEUE_PROJECTIONS,
  satisfies,
  updateSpaceSchema,
  upsertMemberSchema,
  type ApiOk,
  type CreateSpaceDto,
  type SpaceDto,
  type SpaceMemberDto,
  type UpdateSpaceDto,
  type UpsertMemberDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { invalidateSpacePermissions } from "../permissions/permissions.service";
import { getRedis } from "../redis";
import { ZodValidationPipe } from "../zod.pipe";

let projections: Queue | undefined;

function projectionsQueue(): Queue {
  projections ??= new Queue(QUEUE_PROJECTIONS, { connection: getRedis() });
  return projections;
}

/**
 * Space administration (frame 12). Every mutation here changes what *every*
 * page in the space resolves to, so each one ends with a space-wide bitmap
 * invalidation — the page-scoped closure-table walk cannot express this.
 */
@Controller("spaces")
@UseGuards(SessionGuard)
export class SpaceAdminController {
  /** Create a space; the creator becomes its first ADMIN. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSpaceSchema)) body: CreateSpaceDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<SpaceDto>> {
    const prisma = getPrisma();
    const taken = await prisma.space.findUnique({ where: { key: body.key } });
    if (taken) throw new BadRequestException(`The key "${body.key}" is already in use`);

    const space = await prisma.space.create({
      data: {
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility,
        defaultPermLevel: body.defaultPermLevel,
        members: { create: { userId: req.user.id, permLevel: "ADMIN" } },
      },
    });
    return ok(toSpaceDto(space));
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSpaceSchema)) body: UpdateSpaceDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<SpaceDto>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceAdmin(req.user.id, spaceId);
    const before = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!before) throw new NotFoundException("Space not found");

    const space = await prisma.space.update({ where: { id: spaceId }, data: body });

    // Only these two change what anyone can read; a rename does not.
    if (
      (body.visibility !== undefined && body.visibility !== before.visibility) ||
      (body.defaultPermLevel !== undefined && body.defaultPermLevel !== before.defaultPermLevel)
    ) {
      await invalidateSpacePermissions(spaceId);
    }
    return ok(toSpaceDto(space));
  }

  /**
   * Soft delete, 30 days — the same contract as page trash (frame 9). The
   * space's pages keep their own deleted_at untouched, so a restore brings
   * back exactly what was live. Access resolution keeps working so its admins
   * can still find and restore it; what changes immediately is that the space
   * leaves every listing, and its pages leave search.
   */
  @Delete(":id")
  async trash(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ trashed: true; pages: number }>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceAdmin(req.user.id, spaceId);
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("Space not found");
    if (space.deletedAt) throw new BadRequestException("That space is already in the trash");

    await prisma.space.update({
      where: { id: spaceId },
      data: { deletedAt: new Date(), deletedBy: req.user.id },
    });
    const pages = await invalidateSpacePermissions(spaceId);
    await projectionsQueue().add(JOB_SPACE_REINDEX, { spaceId: id });
    return ok({ trashed: true, pages });
  }

  @Post(":id/restore")
  async restore(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ restored: true }>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceAdmin(req.user.id, spaceId);
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("Space not found");
    if (!space.deletedAt) throw new BadRequestException("That space is not in the trash");

    await prisma.space.update({
      where: { id: spaceId },
      data: { deletedAt: null, deletedBy: null },
    });
    await invalidateSpacePermissions(spaceId);
    await projectionsQueue().add(JOB_SPACE_REINDEX, { spaceId: id });
    return ok({ restored: true });
  }

  @Get(":id/members")
  async members(
    @Param("id") id: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<SpaceMemberDto[]>> {
    const spaceId = BigInt(id);
    // Members are visible to anyone who can read the space (frame 13's
    // Settings dialog lists them); only changing them needs ADMIN.
    const level = await getEffectiveSpaceLevel(getPrisma(), req.user.id, spaceId);
    if (!satisfies(level, "VIEW")) {
      throw new ForbiddenException("You don't have access to this space");
    }
    const rows = await getPrisma().spaceMember.findMany({
      where: { spaceId },
      include: { user: true },
      orderBy: { addedAt: "asc" },
    });
    return ok(rows.map(toMemberDto));
  }

  /** Invite by email, or change an existing member's level. */
  @Put(":id/members")
  async upsertMember(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(upsertMemberSchema)) body: UpsertMemberDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<SpaceMemberDto>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceAdmin(req.user.id, spaceId);

    const user = await prisma.appUser.findUnique({ where: { email: body.email } });
    // SCIM is V2, so there is no provisioning path — an invite can only reach
    // someone who has already signed in through the IdP at least once.
    if (!user) {
      throw new NotFoundException(
        `No account for ${body.email}. They need to sign in once before they can be added.`,
      );
    }

    const member = await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId: user.id } },
      create: { spaceId, userId: user.id, permLevel: body.permLevel },
      update: { permLevel: body.permLevel },
      include: { user: true },
    });
    await invalidateSpacePermissions(spaceId);
    return ok(toMemberDto(member));
  }

  @Delete(":id/members/:userId")
  async removeMember(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ removed: true }>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceAdmin(req.user.id, spaceId);

    // A space with no admin cannot be administered again — refuse to remove
    // the last one rather than stranding it.
    const target = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: BigInt(userId) } },
    });
    if (!target) throw new NotFoundException("That person is not a member of this space");
    if (target.permLevel === "ADMIN") {
      const admins = await prisma.spaceMember.count({ where: { spaceId, permLevel: "ADMIN" } });
      if (admins <= 1) {
        throw new BadRequestException("A space must keep at least one admin");
      }
    }

    await prisma.spaceMember.delete({
      where: { spaceId_userId: { spaceId, userId: BigInt(userId) } },
    });
    await invalidateSpacePermissions(spaceId);
    return ok({ removed: true });
  }
}

async function assertSpaceAdmin(userId: bigint, spaceId: bigint): Promise<void> {
  const level = await getEffectiveSpaceLevel(getPrisma(), userId, spaceId);
  if (!satisfies(level, "ADMIN")) {
    throw new ForbiddenException("You need admin on this space");
  }
}

function toSpaceDto(space: {
  id: bigint;
  key: string;
  name: string;
  description: string | null;
  visibility: SpaceDto["visibility"];
  defaultPermLevel: SpaceDto["defaultPermLevel"];
}): SpaceDto {
  return {
    id: space.id.toString(),
    key: space.key,
    name: space.name,
    description: space.description,
    visibility: space.visibility,
    defaultPermLevel: space.defaultPermLevel,
  };
}

function toMemberDto(member: {
  userId: bigint;
  permLevel: SpaceMemberDto["permLevel"];
  addedAt: Date;
  user: { displayName: string; email: string };
}): SpaceMemberDto {
  return {
    userId: member.userId.toString(),
    displayName: member.user.displayName,
    email: member.user.email,
    permLevel: member.permLevel,
    addedAt: member.addedAt.toISOString(),
  };
}
