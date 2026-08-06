/**
 * Revision thinning policy (ADR 0006 operational TODO): after `thinAfterMs`,
 * keep at most one revision per UTC day — the newest of each day. The overall
 * newest revision is never deleted, whatever its age.
 */

export interface ThinnableRevision {
  version: number;
  /** ISO timestamp. */
  createdAt: string;
}

export function chooseRevisionsToThin(
  revisions: ThinnableRevision[],
  now: Date,
  thinAfterMs: number,
): number[] {
  if (revisions.length === 0) return [];
  const cutoff = now.getTime() - thinAfterMs;
  const head = revisions.reduce((a, b) => (a.version > b.version ? a : b));

  const keepPerDay = new Map<string, ThinnableRevision>();
  const old = revisions.filter(
    (r) => r.version !== head.version && new Date(r.createdAt).getTime() < cutoff,
  );
  for (const revision of old) {
    const day = new Date(revision.createdAt).toISOString().slice(0, 10);
    const kept = keepPerDay.get(day);
    if (!kept || revision.version > kept.version) keepPerDay.set(day, revision);
  }
  const keep = new Set([...keepPerDay.values()].map((r) => r.version));
  return old.filter((r) => !keep.has(r.version)).map((r) => r.version);
}
