# ADR 0004: Permission Cache as Redis BITFIELD Bitmaps

**Status:** Accepted (backfilled 2026-08-01; decision predates this document)

## Context

Every page read, search-token mint, and realtime connection needs a permission check. Resolving space baseline + page overrides in SQL each time is too slow; caching per-(user, page) keys explodes (users × pages keys). Permission semantics follow the Notion rule: page-level permissions can only **grant** rights beyond the space baseline, never reduce them — so the effective set is computable per page.

## Decision

- One Redis BITFIELD bitmap per page per permission level: `perm:page:{pageId}:{permLevel}`; the bit offset is the user's bigint id (dense sequence).
- Bitmaps are computed lazily on first check (space baseline ∪ additive page grants) and carry a TTL to bound memory.
- Invalidation on any `page_permission` or space-membership change: delete the page's bitmaps AND all descendants' bitmaps (resolved via `page_ancestor`), then let them recompute lazily.
- Invalidation also emits a perm-changed event consumed by the realtime tier (ADR 0008) so live editors are re-checked.

## Consequences

- O(1) permission checks; memory per key ≈ max_user_id / 8 bytes (10k users ≈ 1.25 KB per page per level), bounded further by TTL + laziness (only hot pages are cached).
- Subtree permission changes fan out deletions across descendants — accepted; deletes are cheap and recompute is lazy.
- Requires dense bigint user ids (already the ID convention) — never switch users to UUIDs without revisiting this ADR.
- Hard rule derived from this ADR: never cache per-(user, block) permission keys (CLAUDE.md rule 3).
