# Angy — Developer Handbook for Claude

Wiki KMS — company knowledge management system. A Confluence-class, blazing-fast, text-media-oriented wiki: Notion-style block editing, real-time collaboration, page-level permissions, full version history, SSR-fast reads.

> **Status: V1 shipped and deployed.** Phases 0–10 and waves A–G are closed; the stack runs on the homelab behind a Pangolin tunnel (ADR 0012). Commands, paths and components below describe **existing** artifacts — read the code before assuming a section is aspirational. Next work is V2: docs/implementation-plan.md § V2.

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
- **Auth**: OIDC via **Authentik**, a single identity provider (ADR 0011); sessions in Redis. SCIM is V2 and rides Authentik's outbound provider.
- **Package manager**: pnpm workspaces

Exact version pins live in README → Prerequisites and, once scaffolded, in package.json/.nvmrc — never in this file.

## Commands

```bash
pnpm install                  # install all workspace deps
pnpm dev                      # start web :3000 + api :3001 + realtime :3002 + worker concurrently
pnpm build                    # build all apps for production
pnpm test                     # run unit + integration tests (vitest)
pnpm test path/to/file.test.ts       # run a single vitest file (path filters)
pnpm test:e2e                 # run playwright e2e suite (needs docker stack up)
pnpm test:e2e -- --grep "<title>"    # run a single playwright test by title
pnpm lint                     # eslint across all packages
pnpm typecheck                # tsc --noEmit across all packages
pnpm db:migrate               # apply pending migrations (prisma)
pnpm db:generate              # regenerate prisma client after schema changes
pnpm db:seed                  # seed dev spaces/pages/users
pnpm docker:up                # bring up postgres/redis/meilisearch/minio locally
pnpm docker:down              # tear down local stack
```

First-time setup order: `pnpm install` → `pnpm docker:up` → `cp .env.example .env.local` (fill in values per docs/env.md) → `pnpm db:migrate && pnpm db:seed` → `pnpm dev`.

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

infra/          # docker-compose (dev + homelab prod), k8s manifests, backup script
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
- **Integration (vitest)**: API routes and Hocuspocus persistence hooks against the **real `pnpm docker:up` stack** (Postgres + Redis + MinIO) — not testcontainers, which nothing imports. `apps/realtime/test` needs `.env.local` for `JWT_SECRET`; CI writes one.
- **E2E (playwright)**: reader SSR render, edit-on-click mount, multi-user collab session, page history restore. Run against the pnpm docker:up stack with all four apps booted, and serve **web from a production build, never `next dev`** — under dev mode StrictMode's double-invoked effects kill the collab socket before it establishes, so all 11 editor specs fail on "1 live connection" while the reader specs pass, looking exactly like a broken editor. **The reader is streamed, so a locator on rendered content can transiently match twice** — the real node plus React's hidden `id="S:…"` template — and strict mode then fails the spec that happened to sample mid-swap. Go through `articleBody()` in `e2e/helpers.ts`; never write a bare `.article-prose`. A lone failure that passes on re-run of the same commit is a flake, not a regression.
- **CRDT convergence test**: two browser contexts edit the same page offline, reconnect, assert converged state. Required for any change to packages/blocks or apps/realtime.

## Critical Gotchas

- **encodeStateAsUpdate on large Y.Docs** can consume 75× the doc size in memory — run compaction in the worker, never in the API request path.
- **Redis BITFIELD bitmaps** are keyed perm:page:{pageId}:{permLevel}; on any page_permission change, delete the page's bitmap AND all descendants' bitmaps (query page_ancestor), then let them recompute lazily. Bitmaps carry a TTL — memory ≈ max_user_id/8 bytes × perm levels × hot pages.
- **Permission revocation must reach live editors**: after bitmap deletion, emit a perm-changed event; the realtime server re-checks that page's connections and downgrades/disconnects them (ADR 0008). Membership/baseline changes publish the *space* instead of its pages — realtime intersects it with the open documents. The client discriminates on the close **reason** (`REVOKED_CLOSE_REASON`), never the code: Hocuspocus hardcodes 1000 for a document-level close, so the server's 4403 never arrives.
- **Meilisearch authz = tenant tokens** whose `searchRules` embed the user's effective read filter (ADR 0009). Never index private content behind a shared client key; never ship the master key to a client. Every index the token covers (`pages`, `attachments`) must carry `space_id`/`page_id` — that shared shape is what lets one filter scope them all.
- **Tag names are workspace-wide and normalised on write** (`normalizeTag`): case-folded, hyphenated, and stripped of the quote/bracket characters that would break a Meilisearch filter literal. Interpolating a tag into a filter is only safe because of that; never skip it. Rename/merge require ADMIN on *every* space the tag appears in.
- **Hocuspocus onLoadDocument** must load exactly the persisted Y.Doc update bytes (never rebuild a doc from document_json/HTML) or clients fork and history duplicates. Hocuspocus v4: hook payloads use web-standard Request/Headers, and onStoreDocument no longer receives context — derive user/page from the document name.
- **Tiptap immediatelyRender: false** is mandatory in Next.js (target: apps/web/components/editor/Editor.tsx). Tiptap 3 renamed CollaborationCursor → CollaborationCaret; disable StarterKit's undoRedo when using Collaboration.
- **Redis Y.Doc hot cache must run noeviction**; the data-loss window equals the store debounce (~2s) — keep it short and alert on Redis memory.
- **Projections can silently go stale** if the worker dies after an S3 write: a reconciliation job compares page.updated_at vs projection timestamps and rebuilds idempotently.
- **Attachment GC**: after the 30-day trash hard-delete, sweep orphaned S3 objects and thumbnails.
- **Page move** = closure-table delete+insert in one transaction under a pg advisory lock with a cycle check.
- **Enforce a single yjs copy** via pnpm overrides — duplicate yjs instances in the workspace break CRDT editing silently. The CJS/ESM boundary is a second instance vector: apps/api (CommonJS) must never import yjs or construct Y.Docs — convert doc bytes only through @angy/blocks helpers (mixing the two builds makes y-prosemirror throw "Unexpected case").
- **BullMQ custom job ids must not contain ":"** — it's reserved for key namespacing.
- **Compaction candidacy compares state vectors, never timestamps** — compaction itself touches page.updated_at, so a timestamp check re-enqueues every page forever.
- **Crashed browser tabs reap at Hocuspocus's ~30s health timeout** (no WS close frame), so idle-cutoff checkpoints from them arrive late — the Done button's explicit checkpoint is the deterministic save path.
- **pg_advisory_xact_lock returns void** — cast it (`::text`) under Prisma $queryRaw or deserialization fails.
- **Public ≠ internal origins behind a proxy.** `S3_ENDPOINT` is for SDK calls; `S3_PUBLIC_ENDPOINT` is for anything a browser fetches — bare media URLs *and presigning*, since SigV4 signs the Host header. `PUBLIC_API_URL` (not the listen port) forms the OIDC redirect_uri and drives the session cookie's `Secure` flag. Collapsing either pair works on localhost and breaks everywhere else (ADR 0012).
- **`NEXT_PUBLIC_*` are baked into the web image at build time**, so the `angy-env` Secret cannot change what the browser talks to — pass them to infra/docker/build.sh per deployment target. Server-side code uses `API_INTERNAL_URL`, which *is* runtime env.
- **Editor plugins registered from React (drag handle) must take referentially stable props** — a new `onNodeChange` identity each render re-registers the ProseMirror plugin, and the reconfigure tears down every other plugin's view (the slash menu silently stops opening).
- **Page links are named at creation time**, because the node is an atom — its label cannot be edited in place, and letting the parent document write it would give `page.title` a second writer alongside `onStoreDocument`.
- **Page links (`pageLink`) resolve through `/p/{pageId}`, never `/s/{key}/{id}`** — a space key baked into a link goes stale the moment the page moves. The cached `title` attribute is repaired in **two** places, because the reader and the editor render from different sources. Readers: `resolvePageLinkTitles` substitutes the target's current title before `rendered_html`/`text_extract` are generated, so the static renderer stays a pure JSON→HTML function and `document_json` keeps the authored label. Editors render the Y.Doc, so the node itself is rewritten — `relabelPageLinks` on `onLoadDocument` (self-healing, and the only thing that fixes links authored before the rename), plus a `relabel` doc command for documents already open. Neither writes `page.title`; `onStoreDocument` stays its only writer.
- **A rename must never fan out over the link graph.** The `relabel` command names the renamed *page*, and realtime intersects it with its open documents — same shape as space-scoped permission events, for the same reason: a hub page is linked from thousands of documents but only a handful are open. Loading each referrer to rewrite an attribute would turn one rename into a storm of S3 reads, revision checkpoints and projection rebuilds. Closed documents need nothing: their readers are already correct, and the doc is repaired on next load. `relabelPageLinks` returning 0 must produce **no** Yjs update, or merely opening a page re-stores and checkpoints it.
- **`block_index` is a projection, never a block table** (hard rule 2) — one row per *actionable* node (page links, mentions, tasks; macros next), written only by `rebuildProjection` and rebuildable from the Y.Doc at any time. Each row records the label **as rendered**, and a rename only re-projects referrers whose recorded label differs: refreshing them unconditionally cascades through the link graph and mutual links never settle. `ord` is a single document-order sequence across kinds — it is half the primary key, so per-kind numbering would collide.
- **Two `@tiptap/suggestion` plugins need distinct `pluginKey`s.** Every instance defaults to the same key and ProseMirror refuses two keyed plugins sharing one, which throws during editor construction — so adding a second menu (`@` beside `/`) takes the *whole editor* down, not just the new menu. The symptom is that `.tiptap[contenteditable]` never mounts.
- **The page title is a `title` Y.Text in the page's own Y.Doc** (`TITLE_FIELD`), not a plain column write: `onStoreDocument` copies it into `page.title`, so anything renaming a page must go through the doc (`rename` doc command) or the next store overwrites it. Never persist an empty title — reseed the doc from the row instead.

## V1 Scope (Ship the Core Editing Experience)

- Spaces + pages + page closure table
- Tiptap block editor: paragraph, heading, list, code, image, table, callout, divider, blockquote, page link (`/page` links an existing page or creates a named child). V2 adds `@` mentions and `/todo` task lists.
- Yjs + Hocuspocus real-time collab, Y.Doc in S3, compaction worker
- SSR read path via @tiptap/static-renderer; edit-on-click mount
- Page-level permissions + Redis bitfield cache + space baseline
- Meilisearch full-text search over text_extract, tenant-token authz
- S3 attachments + Sharp thumbnails + CDN (signed URLs for private spaces)
- OIDC auth (Authentik) — login only
- Page revision history (full-state blobs, ADR 0006) with visual diff and non-destructive restore
- Page move/trash/restore (30-day soft delete)
- REST API only

## Deferred to V2+ (Do NOT Build in V1)

- SCIM provisioning
- GraphQL API
- block_index — **H1 is complete** (V2): table, worker, backlinks, `@` mentions and the tasks board. Still open: the workspace-wide mention inbox and notifications
- Confluence-style macros (Jira, TOC, decision, meeting notes)
- Extension manager / runtime block-type registry (XWiki-style plugins)
- Federated search connectors (Slack, Drive, Jira)
- Git import / Git export (one-directional flows — ADR 0005)
- Confluence/Notion importer
- Page templates
- Notion-style databases-in-pages — **a row is a Page, not a block** (ADR 0013); needs `block_index` first
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
- docs/adr/0011-authentik-single-idp.md — Authentik as the one IdP; why not multi-IdP
- docs/adr/0012-homelab-tunnel-topology.md — five public hostnames behind a Pangolin tunnel
- docs/adr/0013-databases-in-pages.md — deferred; a database row is a Page, and why
- docs/architecture.md — system narrative, data flow, consistency & backup model
- docs/schema.md — table inventory (DDL TODO)
- docs/env.md + .env.example — canonical environment variables
- docs/roadmap.md — V1/V2/V3 sequencing
- docs/implementation-plan.md — the V1 build record (phases 0–10, waves A–G) **and § V2, the live plan**
- docs/TODO.md — what closed and what is still open operationally; next feature work lives in the plan's § V2
- docs/runbooks/compaction.md — operating the Y.Doc compaction worker
- docs/runbooks/dev-debugging.md — local debugging recipes
- docs/runbooks/alerts.md — log-based alert signals ([alert] lines) and responses
- docs/runbooks/key-rotation.md — rotation procedures for every deployment secret
- docs/runbooks/homelab.md — deploying to the home server behind the tunnel

## UI Design Source

- frontend.pen — Pencil design file, the source of truth for all V1 screens (reader, editor, search, history & diff, space home, sign-in, share & permissions, attachments, trash, move page, system states) plus design-system frames (foundations, components, responsive, interaction & density), each in light and dark. Build apps/web to match these frames.
- screenshots/ — PNG renders of every frontend.pen frame (`NN-name-{light,dark}.png`); read these instead of parsing the 2.5MB .pen JSON.

---

For any new architectural decision: add a one-line entry to the relevant section here and a full ADR under docs/adr/. New production gotchas become single bullets. Keep this file under 200 lines.
