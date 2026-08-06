import type { PrismaClient } from "@prisma/client";
import { resolveEffectiveLevel, type PermLevelDto } from "@angy/shared";

/**
 * Source-of-truth permission resolution (space baseline ∪ additive page
 * grants). The Redis bitmap cache (ADR 0004) sits in front of these on the
 * API hot path; realtime and the reader RSC call them directly.
 */

export async function getEffectiveSpaceLevel(
  prisma: PrismaClient,
  userId: bigint,
  spaceId: bigint,
): Promise<PermLevelDto | null> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    include: { members: { where: { userId } } },
  });
  if (!space) return null;
  return resolveEffectiveLevel({
    spaceVisibility: space.visibility,
    spaceDefaultLevel: space.defaultPermLevel,
    memberLevel: space.members[0]?.permLevel ?? null,
    pageGrantLevel: null,
  });
}

export async function getEffectivePageLevel(
  prisma: PrismaClient,
  userId: bigint,
  pageId: string,
): Promise<PermLevelDto | null> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: {
      space: { include: { members: { where: { userId } } } },
      permissions: { where: { userId } },
    },
  });
  if (!page) return null;
  return resolveEffectiveLevel({
    spaceVisibility: page.space.visibility,
    spaceDefaultLevel: page.space.defaultPermLevel,
    memberLevel: page.space.members[0]?.permLevel ?? null,
    pageGrantLevel: page.permissions[0]?.permLevel ?? null,
  });
}
