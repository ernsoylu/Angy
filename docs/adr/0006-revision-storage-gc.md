# ADR 0006: Revisions Are Full-State Blobs — Yjs GC Stays On

**Status:** Accepted 2026-08-01

## Context

The original blueprint specified V1 revision history as "Yjs snapshots (stateVector, deleteSet) stored in page_revision" while hard rule 7 keeps Yjs garbage collection **ON** by default. These are incompatible: a Yjs `Snapshot` can only reconstruct a past document state when the doc runs `gc: false`, because GC prunes exactly the tombstones the snapshot needs. Running gc-off on every page to support history would let tombstones grow unboundedly on the hottest data structure in the system. As written, the V1 history feature was unbuildable.

## Decision

Revision history never uses Yjs `Snapshot` objects. Instead:

- A **revision is a full `Y.encodeStateAsUpdate` blob** written to S3 (`page_revision.revision_s3_key`), plus metadata: `page_id`, `created_by`, `created_at`, optional `label`, `state_vector`, `size_bytes`.
- The **worker** writes revision blobs at checkpoint moments: explicit "save version", compaction runs, and an idle cutoff after a burst of edits. Never per keystroke.
- **Diff** is computed at the projection level: materialize the two revisions' ProseMirror JSON and diff those trees — not CRDT-internal comparison.
- **Restore** is non-destructive: load the old revision's content and apply it to the live Y.Doc as a new forward update (the restore itself becomes the newest revision). History is never rewritten.
- Yjs GC remains ON for every doc (hard rule 7 unchanged). If a special doc ever requires gc-off, nightly compaction must bound its tombstone growth.

## Consequences

- History works for every page with zero CRDT-config exceptions; rule 7 stays absolute.
- Each revision is independently loadable — no replaying update chains to materialize an old version.
- Storage cost ≈ doc size per revision, bounded by checkpoint cadence; a retention policy (e.g. thin out to daily after 30 days) is a V1 operational TODO in docs/schema.md.
- Granularity is checkpoint-level, not keystroke-level — Confluence-grade versioning, which is the product bar.
