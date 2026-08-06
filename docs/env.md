# Environment Variables

Canonical reference for all deployments. [`.env.example`](../.env.example) mirrors the local-dev defaults; copy it to `.env.local` and fill in secrets. Do not duplicate this table in the README.

## Variables

| Variable | Required | Consumed by | Notes |
|----------|----------|-------------|-------|
| `DATABASE_URL` | ✅ | api, worker, packages/db | PostgreSQL connection string |
| `REDIS_URL` | ✅ | api, realtime, worker | Sessions, Y.Doc hot cache, permission bitmaps, BullMQ. Cache instance must run `noeviction` |
| `MEILISEARCH_URL` | ✅ | api, worker | — |
| `MEILISEARCH_API_KEY` | ✅ | api, worker | Master/admin key. Server-side only — clients receive short-lived tenant tokens (ADR 0009) |
| `S3_ENDPOINT` | ✅ | api, realtime, worker, web | **Internal** object-storage address — every SDK call (Y.Doc blobs, revisions, thumbnails) goes here. MinIO locally, AWS S3 in prod |
| `S3_PUBLIC_ENDPOINT` | — | api, worker, web | **Browser-facing** object-storage origin; defaults to `S3_ENDPOINT`. Set it whenever the two differ — e.g. a tunnelled homelab where MinIO answers on `http://minio:9000` internally and `https://media.angy.<domain>` publicly. Bare media URLs *and presigning* use it; SigV4 signs the Host header, so a URL signed against the internal address is rejected at the public one |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✅ | api, realtime, worker | — |
| `S3_BUCKET` | ✅ | api, realtime, worker | Y.Doc blobs, revision blobs, media, thumbnails |
| `S3_REGION` | ✅ | api, realtime, worker | — |
| `OIDC_ISSUER_URL` | ✅ | api | Authentik application issuer — `<host>/application/o/<app-slug>/` (ADR 0011). Must match the `issuer` claim in the discovery document, so the provider needs `issuer_mode: per_provider` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | ✅ | api | — |
| `JWT_SECRET` | ✅ | api, realtime | Signs **short-lived realtime connect tokens and media access tokens** (ADR 0007/0008) — *not* user authentication, which is OIDC + Redis sessions. Random, ≥32 chars |
| `NEXT_PUBLIC_API_URL` | ✅ | web | Public API endpoint. **Build-time**: Next inlines it into the client bundle, so pass it to `infra/docker/build.sh` — setting it in `angy-env` does nothing for the browser |
| `NEXT_PUBLIC_REALTIME_URL` | ✅ | web | Public WebSocket endpoint. Build-time, same as above |
| `API_INTERNAL_URL` | — | web | Server-side API endpoint when it differs from the public one (defaults to `NEXT_PUBLIC_API_URL`) |
| `WEB_ORIGIN` | — | api | CORS origin for the web app (default `http://localhost:3000`) |
| `PUBLIC_API_URL` | — | api | The API's own origin *as the browser sees it* (default: its listen address). Behind a proxy or tunnel this must be set: it forms the OIDC `redirect_uri`, the URL `openid-client` validates the callback against, and — when it is `https:` — flips the session cookie to `Secure` |
| `TRASH_RETENTION_MS` | — | api, worker | Trash hard-delete retention (default 30 days) |
| `COMPACTION_EVERY_MS` | — | worker | Compaction scan cadence (default 6h) |
| `GC_EVERY_MS` | — | worker | Trash/attachment GC sweep cadence (default 6h) |
| `REVISION_THIN_AFTER_MS` | — | worker | Age past which revisions thin to one/day (default 30 days, ADR 0006) |
| `COMPACTION_SIZE_THRESHOLD_BYTES` | — | realtime | Doc size that triggers immediate compaction (default 2 MiB) |

## Production notes

- **Postgres**: enable continuous archiving/PITR; size for metadata + projections only (content blobs live in S3).
- **Redis**: `noeviction` policy; AOF persistence to smooth restarts; alert on memory (Y.Doc hot cache growth).
- **S3**: enable bucket versioning; lifecycle rules for revision retention and GC of hard-deleted media.
- **CDN**: configure the signing keypair / signed-cookie behavior for private-space media (ADR 0007). A homelab deployment with no CDN sets `S3_PUBLIC_ENDPOINT` to a tunnel-exposed MinIO instead — see [ADR 0007](adr/0007-media-access-control.md) and [runbooks/homelab.md](runbooks/homelab.md).
- **Public origins**: set `PUBLIC_API_URL`, `WEB_ORIGIN` and `S3_PUBLIC_ENDPOINT` to the hostnames the *browser* uses. The two `NEXT_PUBLIC_*` values are build-time and must be baked into the web image (`infra/docker/build.sh`).
- Backup/DR model: see [architecture.md § Backup & Disaster Recovery](architecture.md).
