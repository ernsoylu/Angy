/**
 * Tags are freeform (anyone with EDIT can coin one) and workspace-wide: the
 * name is the identity, shared across every space. Normalising on write is
 * what keeps that namespace usable — otherwise "Roadmap", "roadmap " and
 * "road map" become three tags on day one and admin cleanup starts behind.
 */

export const TAG_MAX_LENGTH = 40;

/**
 * Characters that would break a Meilisearch filter expression, where tags are
 * interpolated as quoted literals (ADR 0009). Stripped rather than escaped:
 * a tag is a label, and none of these read as one.
 */
const FILTER_UNSAFE = /["'`\\,[\]()]/g;

/**
 * Canonical form of a tag name, or null if nothing usable is left.
 * Case-folded and hyphenated, but otherwise unicode-preserving — "kırılgan"
 * and "wysokość" are perfectly good tags.
 */
export function normalizeTag(input: string): string | null {
  const name = input
    .normalize("NFC")
    .toLowerCase()
    .replace(FILTER_UNSAFE, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX_LENGTH)
    // A trailing hyphen can reappear after the length cut.
    .replace(/-+$/g, "");
  return name.length > 0 ? name : null;
}

/** Normalize a list, dropping empties and duplicates while keeping order. */
export function normalizeTags(inputs: string[]): string[] {
  const seen = new Set<string>();
  for (const input of inputs) {
    const name = normalizeTag(input);
    if (name) seen.add(name);
  }
  return [...seen];
}
