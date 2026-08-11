# Angy Architecture

> Status: **built** — this describes the running V1, not a target. Hard rules and scope guardrails: [../CLAUDE.md](../CLAUDE.md). Decision rationale: [adr/](adr/).

## The Core Insight: Page as Primitive

**Blocks are not database rows** — they live inside the page as JSONB and CRDT state (ADR 0001):

- **One page** = one Postgres row + one Y.Doc blob in S3 (ADR 0002) + read projections (`document_json`, `rendered_html`, `text_extract`). The Y.Doc holds both the body fragment and a `title` Y.Text, so the title syncs, persists, and restores with the content; `page.title` is a projection of it, written by `onStoreDocument`.
- **Read path**: Next.js RSC streams cached `rendered_html` from Postgres; the worker generated it with `@tiptap/static-renderer`. Readers get fast TTFB (<100ms budget) with zero editor JS.
- **Edit path**: the Tiptap editor mounts client-only on "Edit" click, connects to Hocuspocus (auth: ADR 0008), hydrates from the live Y.Doc in Redis.
- **Realtime**: Yjs CRDT; debounced persistence to S3 every ~2s; presence + awareness in Redis.
- **Live-by-default**: readers trail editors by debounce + projection lag (~2–5s); no draft/publish state in V1 (ADR 0010).
- **History**: append-only `page_revision` pointing at full-state revision blobs in S3; restore applies old content as a new forward version (ADR 0006).
- **Permissions**: space baseline + additive page overrides, cached as Redis BITFIELD bitmaps (ADR 0004); search enforced via Meilisearch tenant tokens (ADR 0009); media via signed URLs for private spaces (ADR 0007).

This design eliminates the scaling bottlenecks of prior blueprints: no per-block closure tables (billion-row explosion), no per-block permission cache (billion Redis keys), no per-block CRDTs (CRDT/relational mismatch). Blocks are fast JSONB payloads, not relational entities.

## Data Flow

Write/edit path:

```
Browser (edit)
    ↓ WebSocket (short-lived connect token — ADR 0008)
Hocuspocus Server (Y.Doc hot in Redis, noeviction)
    ↓ debounced onStoreDocument (~2s)
S3 (Y.Doc blob; revision checkpoints — ADR 0006)
    ↓ job enqueue
Worker (static-render HTML, extract text, thumbnails)
    ↓ Postgres upsert
document_json + rendered_html + text_extract
    ↓
Meilisearch (pages index: text_extract + space_id/page_id filterables)
```

Read path:

```
Browser (read, SSR)
    ↓
Next.js RSC
    ↓ Prisma query
Postgres (rendered_html, page metadata, permission check via bitmap)
    ↓
Stream pre-rendered HTML to browser
```

(block_index — the projection of actionable blocks for tasks/mentions/backlinks — is **V2**, alongside its consumers.)

## Consistency Model

Authoritative stores, by data class:

| Data | Authority | Derived copies |
|---|---|---|
| Page content | **Y.Doc blob in S3** | document_json, rendered_html, text_extract, Meilisearch docs |
| Metadata, hierarchy, permissions | **Postgres** | Redis permission bitmaps (cache, TTL) |
| Revisions | **S3 revision blobs** + page_revision rows | — |
| Presence, hot Y.Doc, sessions, queues | Redis (**never authoritative**) | — |

Rules that follow:

- Every projection is rebuildable from its authority; a lost projection is an inconvenience, never data loss.
- The S3 write happens first; projection updates are async. A worker crash between the two leaves stale `rendered_html`/search — a **reconciliation job** periodically compares `page.updated_at` (bumped on store) against projection timestamps and re-enqueues rebuilds. Rebuilds are idempotent.
- Redis runs **noeviction** for the Y.Doc hot cache: the data-loss window on a Redis crash equals the store debounce (~2s of keystrokes). Keep the debounce short; alert on Redis memory.
- Attachment lifecycle: media objects are content-addressed (sha256); after the 30-day trash hard-delete, a GC sweep removes orphaned objects and thumbnails.
- Page moves rewrite `page_ancestor` rows in one transaction under a Postgres advisory lock with a cycle check, then invalidate descendant permission bitmaps.

## Backup & Disaster Recovery

- **Postgres**: continuous archiving + PITR. Holds metadata, hierarchy, permissions, revision pointers.
- **S3**: bucket versioning + lifecycle rules. Holds all content (Y.Doc + revisions + media) — the content system of record.
- **Redis**: not backed up as data of record; queues re-enqueueable, caches recomputable. Persistence (AOF) only to smooth restarts.
- **Meilisearch**: rebuilt from `text_extract` — a full reindex job is the recovery path, not snapshots.
- Recovery order: restore Postgres → verify S3 pointers resolve (`ydoc_s3_key`, revisions) → recompute projections/search for pages whose stamps disagree.

## Capacity Notes (V1)

- **Realtime**: single Hocuspocus replica, sticky sessions (ADR 0008). One Y.Doc lives in exactly one process; scale-out via Redis pub/sub extension is deferred.
- **Permission bitmaps**: ≈ max_user_id/8 bytes per page per level; TTL + lazy compute keep only hot pages resident (10k users ⇒ ~1.25 KB/key).
- **Compaction**: `encodeStateAsUpdate` can transiently use ~75× doc size — worker-only, bounded concurrency (see [runbooks/compaction.md](runbooks/compaction.md)).
