# ADR 0002: Y.Doc State Lives in S3, Not Postgres

**Status:** Accepted (backfilled 2026-08-01; decision predates this document)

## Context

Every page has a Yjs CRDT document whose encoded state is a binary blob that grows with edit history and is rewritten on every debounced persist (~2s while editing). Storing it as `bytea` in Postgres means TOAST churn and WAL amplification on the hottest write path, bloated base backups, and the DB holding a payload it can never index or query. Object storage is purpose-built for opaque blobs: cheap, versioned, streamed.

## Decision

- Y.Doc state is persisted to S3/MinIO, one object per page (`ydoc_s3_key`), written by the Hocuspocus `onStoreDocument` hook.
- Postgres stores only the pointer (`ydoc_s3_key`) and a small `ydoc_state_vector` (for cheap delta/sync decisions), plus derived read projections (`document_json`, `rendered_html`, `text_extract`).
- Revision blobs (ADR 0006) live in the same bucket, keyed per revision.

## Consequences

- Postgres stays small, fast, and about metadata/permissions; content blobs scale independently and cheaply.
- Two stores must be kept consistent: S3 write → async projection update. A reconciliation job (see docs/architecture.md) repairs stale projections idempotently; the S3 Y.Doc is authoritative for content.
- Cold page opens pay one S3 round-trip; mitigated by the Redis hot cache during active editing.
- Hard rule derived from this ADR: never store Yjs binary blobs in Postgres (CLAUDE.md rule 1).
