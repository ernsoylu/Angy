# Environment Variables

Canonical reference for all deployments. [`.env.example`](../.env.example) mirrors the local-dev defaults; copy it to `.env.local` and fill in secrets. Do not duplicate this table in the README.

## Variables

| Variable | Required | Consumed by | Notes |
|----------|----------|-------------|-------|
| `DATABASE_URL` | ✅ | api, worker, packages/db | PostgreSQL connection string |
| `REDIS_URL` | ✅ | api, realtime, worker | Sessions, Y.Doc hot cache, permission bitmaps, BullMQ. Cache instance must run `noeviction` |
| `MEILISEARCH_URL` | ✅ | api, worker | — |
| `MEILISEARCH_API_KEY` | ✅ | api, worker | Master/admin key. Server-side only — clients receive short-lived tenant tokens (ADR 0009) |
| `S3_ENDPOINT` | ✅ | api, realtime, worker | MinIO locally, AWS S3 in prod |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✅ | api, realtime, worker | — |
| `S3_BUCKET` | ✅ | api, realtime, worker | Y.Doc blobs, revision blobs, media, thumbnails |
| `S3_REGION` | ✅ | api, realtime, worker | — |
| `OIDC_ISSUER_URL` | ✅ | api | Keycloak/Authentik realm URL |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | ✅ | api | — |
| `JWT_SECRET` | ✅ | api, realtime | Signs **short-lived realtime connect tokens and media access tokens** (ADR 0007/0008) — *not* user authentication, which is OIDC + Redis sessions. Random, ≥32 chars |
| `NEXT_PUBLIC_API_URL` | ✅ | web | Public API endpoint |
| `NEXT_PUBLIC_REALTIME_URL` | ✅ | web | Public WebSocket endpoint |
| `API_INTERNAL_URL` | — | web | Server-side API endpoint when it differs from the public one (defaults to `NEXT_PUBLIC_API_URL`) |
| `WEB_ORIGIN` | — | api | CORS origin for the web app (default `http://localhost:3000`) |
| `TRASH_RETENTION_MS` | — | api, worker | Trash hard-delete retention (default 30 days) |
| `COMPACTION_EVERY_MS` | — | worker | Compaction scan cadence (default 6h) |
| `GC_EVERY_MS` | — | worker | Trash/attachment GC sweep cadence (default 6h) |
| `REVISION_THIN_AFTER_MS` | — | worker | Age past which revisions thin to one/day (default 30 days, ADR 0006) |
| `COMPACTION_SIZE_THRESHOLD_BYTES` | — | realtime | Doc size that triggers immediate compaction (default 2 MiB) |

## Production notes

- **Postgres**: enable continuous archiving/PITR; size for metadata + projections only (content blobs live in S3).
- **Redis**: `noeviction` policy; AOF persistence to smooth restarts; alert on memory (Y.Doc hot cache growth).
- **S3**: enable bucket versioning; lifecycle rules for revision retention and GC of hard-deleted media.
- **CDN**: configure the signing keypair / signed-cookie behavior for private-space media (ADR 0007).
- Backup/DR model: see [architecture.md § Backup & Disaster Recovery](architecture.md).
