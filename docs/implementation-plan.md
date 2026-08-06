# V1 Implementation Plan

> Sequencing for building Angy V1 from the design blueprint. Derived from `frontend.pen` (source of truth for UI), CLAUDE.md (hard rules & scope), the ADRs, and docs/roadmap.md. Each phase ends in a shippable, testable state; later phases depend only on earlier ones.

> **Status (2026-08-06): phases 0–10 are complete** — every exit criterion below is implemented and machine-verified (79 unit/integration tests, 25 Playwright e2e tests, all builds green), plus the post-V1 punch list and burn-down waves A–D and F (see § Open gaps for what was closed and what remains).

## Design inputs

`frontend.pen` contains 13 product screens and 5 design-system frames, each in light and dark (theme axis `mode: light|dark`). Frames 12–13 were added after V1 to unblock Wave E:

| Frame | Screen | Built in phase |
|---|---|---|
| 1 | Reader (SSR article, page tree, TOC + page-info rail) | 3 |
| 2 | Editor (live banner, slash menu, bubble toolbar, presence rail) | 4 |
| 3 | Search (facets: spaces/updated/tags; tabs: pages/attachments) | 7 |
| 4 | History & Diff (revision rail, added/removed diff, restore) | 6 |
| 5 | Space Home (stats, pinned, recently updated, members rail) | 3 |
| 6 | Sign in (OIDC) | 2 |
| 7 | Share & Permissions (space baseline + additive page grants) | 5 |
| 8 | Attachments & Media | 8 |
| 9 | Trash & Restore | 9 |
| 10 | Move Page | 9 |
| 11 | System States (loading/empty/restricted/error) | 1 |
| 12 | Space Settings (identity, visibility, members, danger zone) | E *(added 2026-08-06)* |
| 13 | Create Space dialog | E *(added 2026-08-06)* |
| A–E | Foundations, Components ×2, Interaction & Density, Responsive | 1 |

Design tokens: 31 variables in the .pen file — warm neutral surfaces (`bg/surface/sidebar/elevated`), border pair, 3-step text scale, blue `accent` triple (+hover, +on-accent), four pastel semantic hues (`sage/clay/amber/lilac`, each with `-soft`), focus ring, disabled triple, and fonts `Inter` (UI) / `Source Serif 4` (body) / `JetBrains Mono` (code). These become the single CSS custom-property theme in Phase 1.

Responsive contract (frame E): desktop ≥1025 shows tree + article + rail; tablet 641–1024 collapses to icon tree, TOC moves under the title; mobile ≤640 is single column with drawer tree and bottom nav (Home/Search/Page/Me).

## Phase 0 — Repo scaffold & local stack

Monorepo skeleton exactly as CLAUDE.md specifies: `apps/{web,api,realtime,worker}`, `packages/{blocks,db,shared}`, `infra/`, pnpm workspaces with the `packageManager` pin and the **single-yjs pnpm override** from day one. Shared tsconfig/eslint/prettier/vitest config; `pnpm docker:up` compose file (Postgres 17, Redis 8.2 `noeviction`, Meilisearch, MinIO); CI running lint + typecheck + test. Empty NestJS/Next.js/Hocuspocus/BullMQ apps boot under `pnpm dev` on :3000/:3001/:3002.

**Exit:** fresh clone → `pnpm install && pnpm docker:up && pnpm dev` brings up four hello-world processes; CI green.

## Phase 1 — Design system & app shell (`apps/web`)

Port the .pen tokens to CSS custom properties on `:root[data-theme]` (light/dark), matching frame A. Build the component library from frames B/C/D: buttons, inputs, selects, tags, avatars/avatar stacks, toasts, tables, callout, skeleton — plus the **four mandatory system-state components** (loading skeleton, empty, restricted "request access", error "retry") from frame 11; every data surface built later must use them. App shell: top bar (workspace/space crumb, ⌘K search field, presence stack, Edit button, notifications, account), left page-tree sidebar, right contextual rail, responsive per frame E. Storybook (or equivalent) for visual review against `screenshots/`.

**Exit:** shell renders with mock data in both themes at all three breakpoints; components visually match the design frames.

## Phase 2 — Data layer & auth (`packages/db`, `apps/api`)

Prisma schema for V1 tables: `user`, `space`, `page` (with `ydoc_s3_key`, `ydoc_state_vector`, projection columns + timestamps), `page_ancestor` closure table, `page_permission`, `page_revision` (`revision_s3_key`), `attachment`, plus space membership. Naming per conventions (snake_case DB, uuid pages, bigint spaces/users). TypedSQL for closure-table insert/subtree queries. OIDC login (Keycloak in compose for dev) with Redis sessions; sign-in screen (frame 6). Zod DTOs in `packages/shared`; NestJS error shape `{ success:false, error:{ code, message } }`. Seeders for dev spaces/pages/users.

**Exit:** integration tests (testcontainers) cover closure-table ops and auth guard; `pnpm db:migrate && pnpm db:seed` produces a browsable dataset via REST.

## Phase 3 — Blocks, projections & the read path

The product spine — readers before editors:

- `packages/blocks`: Tiptap 3 extensions for the V1 set (paragraph, heading, list, code, image, table, callout, divider, blockquote) defined **once**, consumed by web and worker (isomorphic-block invariant).
- `apps/worker`: projection builder — Y.Doc → `document_json` → `rendered_html` (`@tiptap/static-renderer`) + `text_extract`; reconciliation job comparing `page.updated_at` vs projection timestamps.
- `apps/api`: page CRUD + tree endpoints (closure table), page create writes a fresh Y.Doc blob to S3.
- `apps/web`: Reader (frame 1) — RSC streams `rendered_html`, zero editor JS; breadcrumb, on-this-page TOC, page-info rail (version, contributors, perms summary), View history stub. Space Home (frame 5) — stats, pinned, recently updated, members rail.

**Exit:** seeded pages render server-side matching frame 1; Lighthouse/TTFB measured against the <100ms budget; projection rebuild proven idempotent.

## Phase 4 — Realtime collaborative editing

- `apps/realtime`: Hocuspocus v4 — `onLoadDocument` loads **exactly** the persisted update bytes from S3/Redis (never rebuilt from JSON); Redis hot cache while edited; `onStoreDocument` debounced ~2s → S3 + projection-rebuild enqueue; user/page derived from document name (v4 drops context).
- `apps/web`: editor mounts client-only behind the Edit click (`immediatelyRender:false`), StarterKit with `undoRedo` disabled, Collaboration + CollaborationCaret, presence avatars, "Editing now" rail, live-editing banner, saved indicator, slash menu and bubble toolbar per frame 2.
- Live-by-default loop: reader view reflects edits within ~2–5s (ADR 0010).

**Exit:** the CRDT convergence test (two contexts edit offline, reconnect, converge) passes and becomes a required check; multi-user session matches frame 2.

## Phase 5 — Permissions

Space baseline + additive page grants (Notion rule: grants only widen — the share dialog's warning copy in frame 7 states this). Resolution logic as pure functions in `packages/shared` (unit-tested), cached as Redis BITFIELD bitmaps `perm:page:{pageId}:{level}` with TTL; on change, delete the page's bitmap **and all descendants'** (via `page_ancestor`), then emit perm-changed so the realtime server re-checks live connections and downgrades/disconnects (ADR 0008). Share dialog UI (frame 7) incl. the "clears cached permissions for N descendants" footer. Restricted system state wired to real 403s.

**Exit:** integration tests for inheritance, widening-only, cascade invalidation; e2e: revoked editor is live-disconnected.

## Phase 6 — Revision history & diff

Checkpoint writer (explicit Done/save, compaction, idle cutoff) storing full `encodeStateAsUpdate` blobs to S3 (`revision_s3_key`) — never Yjs Snapshots, GC stays on (ADR 0006). Compaction worker per docs/runbooks/compaction.md — compaction runs **only** in the worker (75× memory gotcha). History screen (frame 4): revision rail with authors/badges (current, compaction), rendered-document diff (added/removed on ProseMirror JSON, not CRDT internals), non-destructive restore applied as a new forward version.

**Exit:** e2e restore test: v46 restored → becomes v48, history intact; diff view matches frame 4.

## Phase 7 — Search

Worker indexes `text_extract` (+ attachment metadata) into Meilisearch on projection rebuild. API endpoint mints per-user **tenant tokens** whose searchRules embed the effective read filter (ADR 0009) — no master key client-side, ever. Search screen (frame 3): ⌘K entry, result cards with breadcrumb + highlighted snippet, facets (spaces, updated, tags), type tabs, result-count/latency header.

**Exit:** e2e: a user never sees a hit from a space they can't read; typo tolerance verified.

## Phase 8 — Attachments & media

Upload endpoint → S3, Sharp thumbnail queue in worker, sha256-keyed immutable CDN URLs, signed URLs for private spaces (ADR 0007). Attachments screen (frame 8) + image block rendering in reader/editor.

**Exit:** private-space media inaccessible without a valid signature; thumbnails generated async; space-home attachment stats real.

## Phase 9 — Page operations

Move (frame 10): closure-table delete+insert in one transaction under a pg advisory lock with cycle check. Trash & restore (frame 9): 30-day soft delete, hard-delete job, then orphaned S3 object + thumbnail sweep (attachment GC). Both invalidate descendant permission bitmaps and reindex search.

**Exit:** move/trash/restore e2e green, incl. permission and search consistency after each operation.

## Phase 10 — Hardening & release readiness

Full Playwright suite (reader SSR, edit-on-click, multi-user collab, history restore, search authz, move/trash) against the compose stack; >80% unit coverage on `packages/shared` and `packages/blocks`; reconciliation + compaction + GC jobs scheduled and observable; alerts on Redis memory (noeviction data-loss window) and projection staleness; k8s manifests in `infra/` reflecting the V1 single-Hocuspocus-replica topology with sticky sessions (ADR 0008); dark mode + responsive audit of every screen against `screenshots/`.

**Exit:** the V1 checklist in docs/roadmap.md is fully demonstrable on a clean deploy.

## Cross-cutting rules (every phase)

- The seven Data Model Constraints in CLAUDE.md are non-negotiable review gates.
- No V2 scope (GraphQL, SCIM, templates, importers, macros, Git flows, databases-in-pages, comments).
- Shared types/zod only from `@angy/shared`; blocks only from `packages/blocks`; Prisma only from `packages/db`.
- One forward-only migration per PR; Conventional Commits.
- Every data surface implements the four system states from frame 11 — no silent failure, no blank ambiguity.

## Dependency graph

```
0 → 1 → (3-web, 4-web)
0 → 2 → 3 → 4 → 5 → 6
                3 → 7, 8
            5,3 → 9
      all → 10
```

Phases 7 and 8 are parallelizable after 3 (5 only gates their authz edges); 6 needs 4's persistence path.

## Open gaps (audit of 2026-08-06)

Everything the plan, the frames, the ADRs, or the runbooks call for — directly or by clear implication — that is not implemented. Ordered by leverage within each group.

### Design-frame features not built

- ~~**Cross-space move**~~ — **done (2026-08-06)**: `movePage` carries the subtree's `space_id` under dual advisory locks with slug de-duplication; the dialog lists every space; moving requires EDIT in the destination space.
- ~~**Tags**~~ — **done (2026-08-06)**: workspace-wide `tag` + `page_tag`, freeform to write and normalised on the way in, with ADMIN-gated rename/merge as the cleanup half. Byline chips (frame 1), a searchable+facetable `tags` index field, and the Tags facet (frame 3).
- ~~**Recent / Starred**~~ — **done (2026-08-06)**: `page_visit` + `page_star`, a throttled conditional upsert written straight from the reader's RSC render, a star toggle in the page-info rail, and space-scoped list routes behind the sidebar's two nav rows.
- ~~**Search over attachments**~~ — **done (2026-08-06)**: an `attachments` index carrying space_id/page_id, so one tenant token's read filter covers both indexes; the Attachments tab is a real filter.
- **Space administration** — no create-space flow or member management; space-home "New page" header button and "Space settings" are unwired.
- ~~**Editor block affordances**~~ — **done (2026-08-06)**: bubble-menu link editor, a table-structure toolbar shown while the caret is in a table, and the `⠿`/`+` gutter (`@tiptap/extension-drag-handle-react`, with `+` opening the same `SLASH_ITEMS` palette).
- **Dialog search fields** — frame 10 "Search spaces and pages…", frame 9 "Search trash".
- ~~**Mobile**~~ — **done (2026-08-06)**: every tab-bar entry routes, with Me rendering the profile, both personal lists, and sign-out. (The full-width "Edit this page" button was already built in Phase 3.)
- ~~**Frame D interaction spec**~~ — **done (2026-08-06)**: page-tree roving-tabindex traversal (↑↓ → ← Enter/Home/End) and the compact density preference join the ⌘K binding, skip link, and Esc handling.
- **Misc** — second IdP button is decorative (single issuer); ~~attachment "Used on N pages"~~ now lists every page sharing the blob's sha256.

### Frame-11 mandate only half-wired

- ~~Route-level states~~ — **done (2026-08-06)**: `loading.tsx`, `error.tsx`, and `not-found.tsx` now render the design-system states.
- ~~Toasts~~ — **done (2026-08-06)**: `ToastProvider` mounted in the shell; uploads, trash actions, restores, and grants report through it.

### ADR / runbook obligations

- ~~Revision retention/thinning~~ — **done (2026-08-06)**: GC sweep thins past-retention revisions to one per day (pure policy unit-tested in shared).
- ~~Media URL re-emission on cross-visibility moves~~ — **done (2026-08-06)**: the worker moves objects between access-class prefixes and realtime rewrites embedded srcs in the live doc; verified in both directions.
- CDN key-rotation runbook (ADR 0007, "before GA"); the CDN layer itself is unprovisioned.
- Search-token guardrail for oversized grant lists + session-tied TTL (ADR 0009) — flat 15-minute tokens, no proxy fallback.
- Size-triggered compaction and the repeated-failure alert (compaction runbook) — interval scan only, alerts are manual log-watching.
- Realtime health endpoint (alerts runbook TODO) — the WS tier is monitored by port only.

### Robustness

- ~~**Realtime token refresh on reconnect**~~ — **done (2026-08-06)**: the provider now takes a token *function*, fetching a fresh page-scoped JWT on every (re)connect.
- ~~Page title is PATCH-based last-write-wins~~ — **done (2026-08-06)**: the title is a `title` Y.Text in the page's own Y.Doc, so it syncs, persists, and restores with the body. `onStoreDocument` copies it into `page.title`; REST renames publish a `rename` doc command rather than writing the row, which is what keeps the two from fighting (the API is CommonJS and must never touch a Y.Doc).
- Revoked live editors see "offline", not the restricted state.
- Reader TOC has no scroll-spy (first heading statically active).

### Ops / infra

- `infra/terraform/` (named in CLAUDE.md's layout) does not exist.
- ~~e2e suite is local-only~~ — **done (2026-08-06)**: a second CI job brings the compose stack up, boots all four apps from their production builds, and runs Playwright; app logs and traces upload on failure.
- ~~Runtime images carry the whole workspace~~ — **done (2026-08-06)**: `infra/docker/prune.sh` deploys each app prod-only and regenerates the Prisma client in the pruned tree; ~1.5 GB → 578–602 MB (web 509 MB via Next standalone).
- ~~No clean-deploy rehearsal~~ — **done (2026-08-06)**: `infra/k8s/rehearse.sh` stands `angy.yaml` up on a throwaway kind cluster with a real `angy-env` Secret and smoke-tests all four workloads plus the SSR read path. It caught two real deploy bugs on the first run: `angy.yaml` had no `imagePullPolicy`, so `:latest` defaulted to `Always` and every pod hit `ErrImagePull`; and `NEXT_PUBLIC_*` are inlined by Next at build time, so the Secret's copies never reached the browser — they are build args on `Dockerfile.web` now.

The first burn-down wave (cross-space move + media re-emission, route-level states + toasts, realtime token refresh) landed 2026-08-06 — struck through above. Waves A–D and F followed the same day: e2e-in-CI, image slimming and the deploy rehearsal on the ops side; editor affordances, tree traversal, density, the mobile tab bar and attachment usage as polish; the per-user models (reading history, stars, Recent/Starred, the Me tab); the collaborative title, and the search surfaces (tags, attachment search). What is left is space administration — now designed, but holding four open questions on frames 12–13 — the multi-IdP call, cloud ops, and a few small standalone items (dialog search fields, revoked-editor state, TOC scroll-spy, search-token guardrail).

## V2 sequencing (dependency-ordered, planned 2026-08-06)

Every remaining item from § Open gaps, arranged by what actually blocks what.
Three real chains exist — testing/deploy (A1 → A2 → A3 → G), per-user models
(C1 → C2 → C3), and the search surfaces (model/index before facet/tab, D1
adjacent to D2 to avoid editing tenant-token searchRules twice). Everything
else is independent.

**Decision gates before their wave starts:** space-settings screen design (no
frame exists), tag semantics (freeform vs curated), whether multi-IdP is a
real requirement, and the cloud provider for terraform/CDN.

**Hidden prerequisite:** space administration needs *space-wide* permission-
bitmap invalidation first — membership changes only ever happened via seed,
so the existing invalidation path is page-scoped (closure-table walk) only.

- **Wave A — foundations (start immediately, parallel to all):**
  A1 e2e-in-CI (compose services in Actions, boot the apps, run the suite);
  A2 image slimming (pnpm deploy + second generate pass) → A3 deploy
  rehearsal (kubectl apply on kind/minikube with a real angy-env Secret).
- **Wave B — independent polish (parallelize freely):** link UI in the bubble
  menu; table row/column controls; `+` inserter + drag handles (reuse
  SLASH_ITEMS); "Used on N pages" (group by sha256); tree arrow keys;
  density preference; mobile Search/Page tabs.
- **Wave C — per-user models:** C1 page_visit + page_star migration, visit
  write on reader render, star toggle in the rail → C2 Recent/Starred
  sidebar lists → C3 mobile "Me" tab (completes frame E's tab bar).
- **Wave D — search surfaces (gate: tag semantics):** D1 tag model +
  page_tag → assignment UI → index field → Tags facet; D2 attachments index
  → tenant-token searchRules for both indexes → functional Attachments tab.
- **Wave E — administration & auth (gates: settings design, IdP answer):**
  E1 space-wide bitmap invalidation → E2 member management + space CRUD →
  E3 settings screen + create-space flow, wiring the two dead buttons;
  E4 config-driven multi-IdP or removal of the decorative button.
- **Wave F — deep editor (any time after A1; isolated but risky):**
  collaborative title as a Y.Text field in the page's Y.Doc, synced to
  page.title on store, with PATCH rename re-routed through the doc-command
  channel. Wants CI e2e in place before touching the store path.
- **Wave G — cloud (last, after A3 + provider decision):** terraform for
  bucket/CDN/DNS; CloudFront edge-signed cookies for media-private/* per
  ADR 0007, replacing S3 presigning in production config.

Critical path with full parallelism: A1 → (B, C, F) → D → E → G, with
A2 → A3 alongside on the ops side. Accepted deviation carried forward:
search-token TTL stays a flat 15 minutes (sessions have no refresh
interval to bind to).
