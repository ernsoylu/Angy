import { getEffectivePageLevel, getPrisma } from "@angy/db";
import { satisfies, type PermLevelDto } from "@angy/shared";
import { getRedis } from "../redis";

/**
 * Permission bitmap cache (ADR 0004): one Redis BITFIELD bitmap per page per
 * level, bit offset = dense bigint user id. A set bit is authoritative until
 * invalidation deletes the key; a zero bit falls through to a source-of-truth
 * recompute (lazy fill). NEVER cache per-(user, block) keys (hard rule 3).
 */

const CACHED_LEVELS: PermLevelDto[] = ["VIEW", "EDIT", "FULL"];
const LEVEL_ORDER: Record<PermLevelDto, number> = { VIEW: 0, EDIT: 1, FULL: 2, ADMIN: 3 };
const BITMAP_TTL_SECONDS = 3600;

export const PERM_CHANGED_CHANNEL = "perm-changed";

const bitmapKey = (pageId: string, level: PermLevelDto) => `perm:page:${pageId}:${level}`;

export async function checkPagePermission(
  userId: bigint,
  pageId: string,
  required: PermLevelDto,
): Promise<boolean> {
  const redis = getRedis();
  const offset = Number(userId);
  if (required !== "ADMIN") {
    const bit = await redis.getbit(bitmapKey(pageId, required), offset);
    if (bit === 1) return true;
  }

  const effective = await getEffectivePageLevel(getPrisma(), userId, pageId);
  if (effective !== null) {
    const pipeline = redis.pipeline();
    for (const level of CACHED_LEVELS) {
      if (LEVEL_ORDER[effective] >= LEVEL_ORDER[level]) {
        pipeline.setbit(bitmapKey(pageId, level), offset, 1);
        pipeline.expire(bitmapKey(pageId, level), BITMAP_TTL_SECONDS);
      }
    }
    await pipeline.exec();
  }
  return satisfies(effective, required);
}

/**
 * On any permission change: delete the page's bitmaps AND every descendant's
 * (via page_ancestor), then publish perm-changed so the realtime tier
 * re-checks live connections (ADR 0008). Bitmaps recompute lazily.
 */
export async function invalidatePagePermissions(pageId: string): Promise<string[]> {
  const prisma = getPrisma();
  const rows = await prisma.pageAncestor.findMany({
    where: { ancestorId: pageId },
    select: { descendantId: true },
  });
  const pageIds = rows.map((r) => r.descendantId);
  if (!pageIds.includes(pageId)) pageIds.push(pageId);

  const keys = pageIds.flatMap((id) => CACHED_LEVELS.map((level) => bitmapKey(id, level)));
  const redis = getRedis();
  await redis.del(...keys);
  await redis.publish(PERM_CHANGED_CHANNEL, JSON.stringify({ pageIds }));
  return pageIds;
}
