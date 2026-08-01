# Angy — Developer Handbook for Claude

Wiki KMS — company knowledge management system. A Confluence-class, blazing-fast, text-media-oriented wiki: Notion-style block editing, real-time collaboration, page-level permissions, full version history, SSR-fast reads.

> **Status: design blueprint.** No application code exists yet. Commands, paths, and components below describe the target system — treat them as the spec to build, not as existing artifacts.

## Tech Stack

- **Language**: TypeScript end-to-end (no Go, no PHP, no Java — ADR 0003)
- **Backend**: Node.js — NestJS REST API + Hocuspocus (realtime) + BullMQ (workers)
- **Frontend**: Next.js App Router + React + Tiptap 3 (ProseMirror); `@tiptap/static-renderer` for the SSR read path
- **DB**: PostgreSQL (metadata, projections, permissions)
- **Cache/Queue**: Redis (Y.Doc hot cache, presence, permission bitmaps, BullMQ)
- **Search**: Meilisearch (typo-tolerant; per-user tenant tokens — ADR 0009)
- **Blob storage**: S3 / MinIO (Y.Doc blobs, revision blobs, media, thumbnails)
- **CDN**: CloudFront / Cloudflare (immutable sha256-keyed media URLs; signed for private spaces — ADR 0007)
- **CRDT**: Yjs + y-prosemirror + Hocuspocus (one Y.Doc per page)
- **Auth**: OIDC (Keycloak/Authentik); sessions in Redis. SCIM is V2.
- **Package manager**: pnpm workspaces

Exact version pins live in README → Prerequisites and, once scaffolded, in package.json/.nvmrc — never in this file.

## Commands

```bash
pnpm install                  # install all workspace deps
pnpm dev                      # start web + api + realtime + worker concurrently
pnpm build                    # build all apps for production
pnpm test                     # run unit + integration tests (vitest)
pnpm test:e2e                 # run playwright e2e suite
pnpm lint                     # eslint across all packages
pnpm typecheck                # tsc --noEmit across all packages
pnpm db:migrate               # apply pending migrations (prisma)
pnpm db:generate              # regenerate prisma client after schema changes
pnpm db:seed                  # seed dev spaces/pages/users
pnpm docker:up                # bring up postgres/redis/meilisearch/minio locally
pnpm docker:down              # tear down local stack
```

## Monorepo Structure

```
apps/
  web/          # Next.js reader (SSR) + editor (client-only Tiptap)
  api/          # NestJS REST (page tree, search tokens, uploads, permissions)
  realtime/     # Hocuspocus WebSocket server (Y.Doc sync + persistence hooks)
  worker/       # BullMQ workers: compaction, revision checkpoints, projections, thumbnails, reconciliation

packages/
  blocks/       # Shared Tiptap extensions, ProseMirror schema, static block-type registry (compile-time; runtime plugin manager is V2)
  db/           # Prisma schema, migrations, client, seeders, TypedSQL for closure-table ops
  shared/       # DTOs, zod schemas, types, constants shared across apps

infra/          # docker-compose, k8s manifests, terraform
docs/           # ADRs, architecture, schema, env, roadmap, runbooks
```

## Architecture (Core Model)

The Page is the primary relational entity. Blocks are a JSONB/CRDT payload inside it — never first-class DB rows. Full narrative and diagrams: docs/architecture.md.

- **One page** = one Postgres row + one Y.Doc blob in S3 + read projections (document_json, rendered_html, text_extract).
- **Read path**: Next.js RSC streams rendered_html from Postgres; the worker generated it with `@tiptap/static-renderer`. No editor JS shipped to readers.
- **Edit path**: editor mounts client-side only on explicit "Edit" click, connects to Hocuspocus, hydrates from the live Y.Doc.
- **Realtime**: one Y.Doc per page, held in Redis while edited, persisted to S3 via onStoreDocument (debounced ~2s). Auth, live revocation, and topology: ADR 0008.
- **Live-by-default**: readers see edits ~2–5s behind (debounce + projection rebuild); there is no draft/publish state in V1 (ADR 0010).
- **Hierarchy**: page_ancestor closure table over pages only — never blocks.
- **Permissions**: space-level baseline + page-level overrides (Notion rule: page perms can only grant rights, never reduce). Cached as Redis BITFIELD bitmaps — one key per page per permission level (ADR 0004).
- **History**: page_revision rows point at full Y.Doc state blobs in S3 (revision_s3_key), written at checkpoints (explicit save, compaction, idle cutoff). Diff = compare the two revisions' ProseMirror JSON; restore = apply the old content to the live doc as a new forward update — non-destructive (ADR 0006).

## Data Model Constraints (Hard Rules)

1. **Never store Yjs binary blobs in Postgres.** Y.Doc state goes to S3; Postgres holds only the ydoc_s3_key + a small ydoc_state_vector.
2. **Never create a block relational table or a block_ancestor closure table.** Blocks live inside page.document_json (JSONB) and the Y.Doc.
3. **Never cache permissions as per-(user, block) Redis keys.** Use one BITFIELD bitmap per page.
4. **Never tie a Y.Doc to an individual block.** One Y.Doc = one page, always.
5. **Never offer two-way Git sync on the same document.** Git import (Markdown → fresh Y.Doc) and Git export (Y.Doc → Markdown) are separate one-directional flows; round-tripping destroys CRDT tombstones.
6. **Never mount the Tiptap editor during SSR.** Set immediatelyRender: false and gate editor mount behind an explicit "Edit" action to avoid hydration mismatch.
7. **Yjs GC stays ON — always.** Consequently revision history must never rely on Yjs Snapshots (they require gc:false); revisions are full encodeStateAsUpdate blobs (ADR 0006). If a specific doc ever needs gc off, the compaction worker MUST merge it into a fresh snapshot at least nightly to bound tombstone growth.

## Coding Conventions

- **Shared types** live in packages/shared — never duplicate a DTO between apps/api and apps/web. Import from @angy/shared.
- **Tiptap extensions** are defined once in packages/blocks and consumed by both apps/web (editor) and apps/worker (static renderer). This is the isomorphic-block invariant — do not reimplement a block's rendering in two places.
- **Validation**: zod schemas in packages/shared are the single source of truth for request/response shapes; NestJS pipes consume them.
- **API surface**: REST only in V1 (NestJS controllers). GraphQL is deferred to V2 — do not add resolvers or schema-first scaffolding in V1.
- **DB access**: Prisma client from packages/db only. Raw SQL is allowed only in migrations and in packages/db TypedSQL (`$queryRawTyped`) for page_ancestor closure-table maintenance and subtree queries.
- **Migrations**: one migration per PR, forward-only, named <timestamp>_<slug>.sql. Never edit a merged migration.
- **Error shape**: all API errors return { success: false, error: { code, message, details? } }.
- **Naming**: snake_case for DB columns and table names; camelCase for TS fields; PascalCase for types/classes. Prisma maps between them.
- **IDs**: uuid for pages/blocks (gen_random_uuid), bigint for spaces, users, attachments.
- **Commits**: Conventional Commits (feat:, fix:, docs:, …).

## Testing

- **Unit (vitest)**: pure functions, zod schemas, block serializers, permission resolution logic. Target >80% on packages/shared and packages/blocks.
- **Integration (vitest + testcontainers)**: API routes against a real Postgres + Redis; Hocuspocus persistence hooks against S3 (MinIO container).
- **E2E (playwright)**: reader SSR render, edit-on-click mount, multi-user collab session, page history restore. Run against pnpm docker:up stack.
- **CRDT convergence test**: two browser contexts edit the same page offline, reconnect, assert converged state. Required for any change to packages/blocks or apps/realtime.

## Critical Gotchas

- **encodeStateAsUpdate on large Y.Docs** can consume 75× the doc size in memory — run compaction in the worker, never in the API request path.
- **Redis BITFIELD bitmaps** are keyed perm:page:{pageId}:{permLevel}; on any page_permission change, delete the page's bitmap AND all descendants' bitmaps (query page_ancestor), then let them recompute lazily. Bitmaps carry a TTL — memory ≈ max_user_id/8 bytes × perm levels × hot pages.
- **Permission revocation must reach live editors**: after bitmap deletion, emit a perm-changed event; the realtime server re-checks that page's connections and downgrades/disconnects them (ADR 0008).
- **Meilisearch authz = tenant tokens** whose `searchRules` embed the user's effective read filter (ADR 0009). Never index private content behind a shared client key; never ship the master key to a client.
- **Hocuspocus onLoadDocument** must load exactly the persisted Y.Doc update bytes (never rebuild a doc from document_json/HTML) or clients fork and history duplicates. Hocuspocus v4: hook payloads use web-standard Request/Headers, and onStoreDocument no longer receives context — derive user/page from the document name.
- **Tiptap immediatelyRender: false** is mandatory in Next.js (target: apps/web/components/editor/Editor.tsx). Tiptap 3 renamed CollaborationCursor → CollaborationCaret; disable StarterKit's undoRedo when using Collaboration.
- **Redis Y.Doc hot cache must run noeviction**; the data-loss window equals the store debounce (~2s) — keep it short and alert on Redis memory.
- **Projections can silently go stale** if the worker dies after an S3 write: a reconciliation job compares page.updated_at vs projection timestamps and rebuilds idempotently.
- **Attachment GC**: after the 30-day trash hard-delete, sweep orphaned S3 objects and thumbnails.
- **Page move** = closure-table delete+insert in one transaction under a pg advisory lock with a cycle check.
- **Enforce a single yjs copy** via pnpm overrides — duplicate yjs instances in the workspace break CRDT editing silently.

## V1 Scope (Ship the Core Editing Experience)

- Spaces + pages + page closure table
- Tiptap block editor: paragraph, heading, list, code, image, table, callout, divider, blockquote
- Yjs + Hocuspocus real-time collab, Y.Doc in S3, compaction worker
- SSR read path via @tiptap/static-renderer; edit-on-click mount
- Page-level permissions + Redis bitfield cache + space baseline
- Meilisearch full-text search over text_extract, tenant-token authz
- S3 attachments + Sharp thumbnails + CDN (signed URLs for private spaces)
- OIDC auth (Keycloak/Authentik) — login only
- Page revision history (full-state blobs, ADR 0006) with visual diff and non-destructive restore
- Page move/trash/restore (30-day soft delete)
- REST API only

## Deferred to V2+ (Do NOT Build in V1)

- SCIM provisioning
- GraphQL API
- block_index projection table + worker + UI (tasks board, mentions backlinks)
- Confluence-style macros (Jira, TOC, decision, meeting notes)
- Extension manager / runtime block-type registry (XWiki-style plugins)
- Federated search connectors (Slack, Drive, Jira)
- Git import / Git export (one-directional flows — ADR 0005)
- Confluence/Notion importer
- Page templates
- Notion-style databases-in-pages (structured data via class/property model)
- PDF / Word export via headless Puppeteer queue
- Per-line authorship / blame view
- Comments (V3 in the roadmap; strong V2 candidate)

## Reference Documents

- docs/adr/0001-page-as-primitive.md — why blocks are JSONB, not rows
- docs/adr/0002-ydoc-in-s3-not-postgres.md — CRDT blob storage decision
- docs/adr/0003-unified-typescript-stack.md — why no Go
- docs/adr/0004-permission-bitmap-cache.md — Redis BITFIELD design
- docs/adr/0005-git-sync-directionality.md — import/export only, no round-trip
- docs/adr/0006-revision-storage-gc.md — revisions = full-state blobs; GC stays on
- docs/adr/0007-media-access-control.md — signed URLs for private-space media
- docs/adr/0008-realtime-auth-scaling.md — WS auth, live revocation, V1 topology
- docs/adr/0009-search-authz-tenant-tokens.md — Meilisearch tenant-token filters
- docs/adr/0010-live-editing-vs-publish.md — live-by-default, no draft state in V1
- docs/architecture.md — system narrative, data flow, consistency & backup model
- docs/schema.md — table inventory (DDL TODO)
- docs/env.md + .env.example — canonical environment variables
- docs/roadmap.md — V1/V2/V3 sequencing
- docs/runbooks/compaction.md — operating the Y.Doc compaction worker
- docs/runbooks/dev-debugging.md — local debugging recipes

---

For any new architectural decision: add a one-line entry to the relevant section here and a full ADR under docs/adr/. New production gotchas become single bullets. Keep this file under 200 lines.
