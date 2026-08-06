import type { PermLevelDto } from "./dto.js";

/** Permission lattice: VIEW < EDIT < FULL < ADMIN. */
const LEVEL_ORDER: Record<PermLevelDto, number> = { VIEW: 0, EDIT: 1, FULL: 2, ADMIN: 3 };

export function satisfies(level: PermLevelDto | null, required: PermLevelDto): boolean {
  return level !== null && LEVEL_ORDER[level] >= LEVEL_ORDER[required];
}

export function maxLevel(a: PermLevelDto | null, b: PermLevelDto | null): PermLevelDto | null {
  if (a === null) return b;
  if (b === null) return a;
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

export interface EffectiveLevelInput {
  spaceVisibility: "PUBLIC" | "PRIVATE";
  /** The space baseline granted to every workspace user of a PUBLIC space. */
  spaceDefaultLevel: PermLevelDto;
  /** The user's explicit space membership level, if any. */
  memberLevel: PermLevelDto | null;
  /** The user's additive page grant, if any. */
  pageGrantLevel: PermLevelDto | null;
}

/**
 * Effective page-level permission (Notion rule): the space baseline for the
 * user, widened — never narrowed — by an additive page grant. Members of a
 * PRIVATE space use their membership level; non-members have no baseline but
 * can still be granted page access explicitly.
 */
export function resolveEffectiveLevel(input: EffectiveLevelInput): PermLevelDto | null {
  const baseline =
    input.memberLevel ?? (input.spaceVisibility === "PUBLIC" ? input.spaceDefaultLevel : null);
  return maxLevel(baseline, input.pageGrantLevel);
}

/**
 * A page grant is valid only if it widens the user's baseline (grants can
 * never reduce access — enforced at write time, surfaced in the share dialog).
 */
export function grantWidensBaseline(
  grant: PermLevelDto,
  baseline: PermLevelDto | null,
): boolean {
  return baseline === null || LEVEL_ORDER[grant] > LEVEL_ORDER[baseline];
}

/**
 * Close reason the realtime server uses when it disconnects a live editor
 * whose access was revoked (ADR 0008).
 *
 * The *reason* is the discriminator, not the close code: when Hocuspocus
 * closes one document on a shared socket it sends a CLOSE message, and the
 * provider synthesises the event with code 1000 hardcoded — whatever code the
 * server passed is lost. The string is all that survives the trip.
 */
export const REVOKED_CLOSE_REASON = "permission-revoked";
