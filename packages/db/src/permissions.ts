import type { PrismaClient } from "@prisma/client";
import { resolveEffectiveLevel, satisfies, type PermLevelDto } from "@angy/shared";

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

/**
 * Which of these pages the caller may read, resolved in one query instead of
 * one per page.
 *
 * List surfaces (backlinks today, mentions next) hold candidates the caller
 * may not be allowed to see, and each row discloses a title — so they have to
 * be filtered, not merely ordered. Doing that through `getEffectivePageLevel`
 * would cost a round trip per candidate; this pays one for the whole set.
 * Single-page checks on the API keep going through the bitmap cache
 * (ADR 0004), which is faster still for the case it covers.
 */
export async function filterReadablePages(
  prisma: PrismaClient,
  userId: bigint,
  pageIds: readonly string[],
  required: PermLevelDto = "VIEW",
): Promise<Set<string>> {
  if (pageIds.length === 0) return new Set();
  const pages = await prisma.page.findMany({
    where: { id: { in: [...pageIds] }, deletedAt: null, space: { deletedAt: null } },
    include: {
      space: { include: { members: { where: { userId } } } },
      permissions: { where: { userId } },
    },
  });

  const readable = new Set<string>();
  for (const page of pages) {
    const level = resolveEffectiveLevel({
      spaceVisibility: page.space.visibility,
      spaceDefaultLevel: page.space.defaultPermLevel,
      memberLevel: page.space.members[0]?.permLevel ?? null,
      pageGrantLevel: page.permissions[0]?.permLevel ?? null,
    });
    if (satisfies(level, required)) readable.add(page.id);
  }
  return readable;
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
