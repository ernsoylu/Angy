import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { getEffectiveSpaceLevel, getPrisma, type Space } from "@angy/db";
import {
  ok,
  satisfies,
  type ApiOk,
  type PageSummaryDto,
  type SpaceDto,
  type SpaceHomeDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";

async function assertSpaceView(userId: bigint, spaceId: bigint): Promise<void> {
  const level = await getEffectiveSpaceLevel(getPrisma(), userId, spaceId);
  if (!satisfies(level, "VIEW")) {
    throw new ForbiddenException("You don't have access to this space");
  }
}

function toDto(space: Space): SpaceDto {
  return {
    id: space.id.toString(),
    key: space.key,
    name: space.name,
    description: space.description,
    visibility: space.visibility,
    defaultPermLevel: space.defaultPermLevel,
  };
}

@Controller("spaces")
@UseGuards(SessionGuard)
export class SpacesController {
  @Get()
  async list(@Req() req: AuthedRequest): Promise<ApiOk<SpaceDto[]>> {
    const spaces = await getPrisma().space.findMany({
      where: {
        // A trashed space vanishes from every listing; its admins reach it
        // through the trash screen until the 30 days run out.
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: req.user.id } } }],
      },
      orderBy: { name: "asc" },
    });
    return ok(spaces.map(toDto));
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() req: AuthedRequest): Promise<ApiOk<SpaceDto>> {
    await assertSpaceView(req.user.id, BigInt(id));
    const space = await getPrisma().space.findUnique({ where: { id: BigInt(id) } });
    if (!space || space.deletedAt) throw new NotFoundException("Space not found");
    return ok(toDto(space));
  }

  /** Space home (frame 5): stats, recently updated, members. */
  @Get(":id/home")
  async home(@Param("id") id: string, @Req() req: AuthedRequest): Promise<ApiOk<SpaceHomeDto>> {
    const prisma = getPrisma();
    const spaceId = BigInt(id);
    await assertSpaceView(req.user.id, spaceId);
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw new NotFoundException("Space not found");

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [pages, updatedToday, creators, recent, members, attachments] = await Promise.all([
      prisma.page.count({ where: { spaceId, deletedAt: null } }),
      prisma.page.count({ where: { spaceId, deletedAt: null, updatedAt: { gte: startOfDay } } }),
      prisma.page.findMany({
        where: { spaceId, deletedAt: null },
        distinct: ["createdBy"],
        select: { createdBy: true },
      }),
      prisma.page.findMany({
        where: { spaceId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { parent: { select: { title: true } } },
      }),
      prisma.spaceMember.findMany({
        where: { spaceId },
        include: { user: true },
        orderBy: { addedAt: "asc" },
      }),
      prisma.attachment.aggregate({
        where: { page: { spaceId }, deletedAt: null },
        _sum: { sizeBytes: true },
      }),
    ]);

    const editorIds = [...new Set(recent.map((p) => p.updatedBy ?? p.createdBy))];
    const editors = await prisma.appUser.findMany({ where: { id: { in: editorIds } } });
    const nameOf = new Map(editors.map((u) => [u.id.toString(), u.displayName]));

    return ok({
      space: toDto(space),
      stats: {
        pages,
        contributors: creators.length,
        updatedToday,
        attachmentBytes: Number(attachments._sum.sizeBytes ?? 0n),
      },
      recentlyUpdated: recent.map((p) => ({
        id: p.id,
        title: p.title,
        parentTitle: p.parent?.title ?? null,
        updatedByName: nameOf.get((p.updatedBy ?? p.createdBy).toString()) ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
      members: members.map((m) => ({
        id: m.userId.toString(),
        displayName: m.user.displayName,
        permLevel: m.permLevel,
      })),
    });
  }

  /** Flat live page list for the space — clients rebuild the tree from parentId. */
  @Get(":id/pages")
  async pages(@Param("id") id: string, @Req() req: AuthedRequest): Promise<ApiOk<PageSummaryDto[]>> {
    await assertSpaceView(req.user.id, BigInt(id));
    const pages = await getPrisma().page.findMany({
      where: { spaceId: BigInt(id), deletedAt: null },
      // (ord, id) is the sibling order, tie-break included — the client
      // rebuilds the tree by parentId and must not re-sort.
      orderBy: [{ ord: "asc" }, { id: "asc" }],
      select: { id: true, title: true, slug: true, parentId: true },
    });
    return ok(pages);
  }
}
