# Implementation Plan

> How Angy got built, and what is built next. Phases 0–10 and waves A–G are the
> V1 record (complete); [§ V2](#v2) is the live plan. Derived from
> `frontend.pen` (source of truth for UI), CLAUDE.md (hard rules & scope), the
> ADRs, and docs/roadmap.md. Each phase ends in a shippable, testable state;
> later phases depend only on earlier ones.

> **Status: shipped.** Phases 0–10 and the post-V1 burn-down waves A–G are all complete, and the result is deployed (ADR 0012). Every exit criterion below is implemented and machine-verified: 91 unit/integration tests, 39 Playwright e2e tests, lint/typecheck/build green. § Open gaps records what the audit found and how each item closed; **§ V2 is the section with work left in it.**

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

Prisma schema for V1 tables: `user`, `space`, `page` (with `ydoc_s3_key`, `ydoc_state_vector`, projection columns + timestamps), `page_ancestor` closure table, `page_permission`, `page_revision` (`revision_s3_key`), `attachment`, plus space membership. Naming per conventions (snake_case DB, uuid pages, bigint spaces/users). TypedSQL for closure-table insert/subtree queries. OIDC login (Authentik in compose for dev, ADR 0011) with Redis sessions; sign-in screen (frame 6). Zod DTOs in `packages/shared`; NestJS error shape `{ success:false, error:{ code, message } }`. Seeders for dev spaces/pages/users.

**Exit:** integration tests (vitest against the `pnpm docker:up` stack) cover closure-table ops and auth guard; `pnpm db:migrate && pnpm db:seed` produces a browsable dataset via REST.

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
- ~~**Space administration**~~ — **done (2026-08-06)**: the API half is: space create/update, member list/invite/change-level/remove, all ADMIN-gated, each ending in a space-wide bitmap invalidation (a new operation — nothing in the closure table expresses "the whole space"). The settings screen (frame 12), the create-space dialog (frame 13) and both dead buttons are **done** too, along with a 30-day space soft delete and the tag-cleanup surface.
- ~~**Editor block affordances**~~ — **done (2026-08-06)**: bubble-menu link editor, a table-structure toolbar shown while the caret is in a table, and the `⠿`/`+` gutter (`@tiptap/extension-drag-handle-react`, with `+` opening the same `SLASH_ITEMS` palette).
- ~~**Dialog search fields**~~ — **both already existed**; the gap line was stale. What was actually wrong is fixed: the move dialog kept every space header regardless of matches (so a search read as noise around no result), and the trash field searched titles only. Both now report an empty filter instead of showing a bare header.
- ~~**Mobile**~~ — **done (2026-08-06)**: every tab-bar entry routes, with Me rendering the profile, both personal lists, and sign-out. (The full-width "Edit this page" button was already built in Phase 3.)
- ~~**Frame D interaction spec**~~ — **done (2026-08-06)**: page-tree roving-tabindex traversal (↑↓ → ← Enter/Home/End) and the compact density preference join the ⌘K binding, skip link, and Esc handling.
- ~~**Misc**~~ — the second IdP button is **gone**: Authentik is the single identity provider (ADR 0011) and there was only ever one issuer behind both buttons. ~~attachment "Used on N pages"~~ now lists every page sharing the blob's sha256.

### Frame-11 mandate only half-wired

- ~~Route-level states~~ — **done (2026-08-06)**: `loading.tsx`, `error.tsx`, and `not-found.tsx` now render the design-system states.
- ~~Toasts~~ — **done (2026-08-06)**: `ToastProvider` mounted in the shell; uploads, trash actions, restores, and grants report through it.

### ADR / runbook obligations

- ~~Revision retention/thinning~~ — **done (2026-08-06)**: GC sweep thins past-retention revisions to one per day (pure policy unit-tested in shared).
- ~~Media URL re-emission on cross-visibility moves~~ — **done (2026-08-06)**: the worker moves objects between access-class prefixes and realtime rewrites embedded srcs in the live doc; verified in both directions.
- ~~CDN unprovisioned~~ — **resolved (2026-08-06)**: there is no CDN tier and will not be one. The homelab serves media from a tunnel-exposed MinIO instead (ADR 0007 amendment), which is why `S3_PUBLIC_ENDPOINT` exists. The key-rotation runbook's CDN section applies only if a CDN is ever introduced.
- ~~Search-token guardrail for oversized grant lists~~ — **already built**: past 200 explicit grants the token is withheld and search proxies through the API (`GRANT_GUARDRAIL`). The gap line was stale. Session-tied TTL stays an accepted deviation: sessions have no refresh interval to bind to.
- ~~Size-triggered compaction and the repeated-failure alert~~ — **already built**: `onStoreDocument` enqueues compaction the moment a blob crosses `COMPACTION_SIZE_THRESHOLD_BYTES`, and the worker emits `[alert] compaction failed N× consecutively` after three strikes. The gap line was stale.
- ~~Realtime health endpoint~~ — **already built**: the WS tier answers `GET /health` from its `onRequest` hook. The gap line was stale.

### Robustness

- ~~**Realtime token refresh on reconnect**~~ — **done (2026-08-06)**: the provider now takes a token *function*, fetching a fresh page-scoped JWT on every (re)connect.
- ~~Page title is PATCH-based last-write-wins~~ — **done (2026-08-06)**: the title is a `title` Y.Text in the page's own Y.Doc, so it syncs, persists, and restores with the body. `onStoreDocument` copies it into `page.title`; REST renames publish a `rename` doc command rather than writing the row, which is what keeps the two from fighting (the API is CommonJS and must never touch a Y.Doc).
- ~~Revoked live editors see "offline"~~ — **done (2026-08-06)**: the editor now matches on the close *reason*, not the code. Hocuspocus synthesises a document-level close with code 1000 hardcoded, so the server's 4403 never reaches the client; the reason string is the only thing that survives, and it is a shared constant now.
- ~~Reader TOC has no scroll-spy~~ — **already built**: `Toc.tsx` tracks the heading in view with an IntersectionObserver. The gap line was stale.

### Ops / infra

- ~~`infra/terraform/` does not exist~~ — **and will not (2026-08-07, G5)**: no cloud account, no CDN, no DNS zone to manage. Terraform would describe a VPS the project does not own. CLAUDE.md's layout no longer names it.
- ~~e2e suite is local-only~~ — **done (2026-08-06)**: a second CI job brings the compose stack up, boots all four apps from their production builds, and runs Playwright; app logs and traces upload on failure.
- ~~Runtime images carry the whole workspace~~ — **done (2026-08-06)**: `infra/docker/prune.sh` deploys each app prod-only and regenerates the Prisma client in the pruned tree; ~1.5 GB → 578–602 MB (web 509 MB via Next standalone).
- ~~No clean-deploy rehearsal~~ — **done (2026-08-06)**: `infra/k8s/rehearse.sh` stands `angy.yaml` up on a throwaway kind cluster with a real `angy-env` Secret and smoke-tests all four workloads plus the SSR read path. It caught two real deploy bugs on the first run: `angy.yaml` had no `imagePullPolicy`, so `:latest` defaulted to `Always` and every pod hit `ErrImagePull`; and `NEXT_PUBLIC_*` are inlined by Next at build time, so the Secret's copies never reached the browser — they are build args on `Dockerfile.web` now.

The first burn-down wave (cross-space move + media re-emission, route-level states + toasts, realtime token refresh) landed 2026-08-06 — struck through above. Waves A–D and F followed the same day: e2e-in-CI, image slimming and the deploy rehearsal on the ops side; editor affordances, tree traversal, density, the mobile tab bar and attachment usage as polish; the per-user models (reading history, stars, Recent/Starred, the Me tab); the collaborative title, and the search surfaces (tags, attachment search). Every design-frame feature and robustness item in this audit is now closed, and so is every wave except G. Deployment is the last chapter — and it is a homelab behind Pangolin tunnels rather than a cloud, which changes what ADR 0007's media story and ADR 0008's sticky-session requirement have to survive. See docs/TODO.md § Wave G.

## Post-V1 burn-down sequencing (waves A–G) — ✅ complete 2026-08-07

> Historical. This is the plan that closed § Open gaps above; every wave in it
> shipped. It is kept because the reasoning about what blocked what is still
> the best record of why the system is shaped this way — but nothing here is
> outstanding. For what to build next, see § V2 below.

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

## V2

> The live section. V1 is shipped and deployed; everything below is unbuilt.
> Product-facing list and its ordering rationale: [roadmap.md](roadmap.md).
> Scope guardrails: [../CLAUDE.md](../CLAUDE.md) § Deferred to V2+.

V2 has one structural decision at its head and a long tail of independent
features. The structure comes from a single fact: **four separate V2 items all
need the same missing thing, a queryable projection of what is *inside* pages.**
V1 projects a page three ways — `document_json`, `rendered_html`,
`text_extract` — and none of them can answer "which pages link here", "which
pages mention me", or "which rows have status=Done". That projection is
`block_index`, and it is the gate.

### H1 · `block_index` — the projection everything waits on

The one item that is not optional, because backlinks, mentions, the tasks board
and databases (ADR 0013) are each blocked on it and none of them can be
prototyped without guessing at its shape.

**Gate answered *(2026-08-11)*: one row per *actionable node*.** Neither of the
two shapes the gate named survived contact with all four consumers. Per-block
was rejected for the reason the gate anticipated — indexing paragraphs nobody
queries. But per-(page, referenced-entity) was rejected too: deduplicating to
one row per pair leaves nowhere to put a task's text or done-state, so the
tasks board would have needed a second table within the same wave. Occurrence
granularity over actionable nodes only — links, mentions, tasks, macros, never
prose — is what ADR 0001 already committed to ("actionable blocks only"), and
rows scale with references rather than with document size.

Build order within the wave:

1. ✅ **Schema + worker** *(2026-08-11)* — `block_index` (page_id, ord, kind,
   target_page_id, target_user_id, payload), written by `rebuildProjection`
   and nowhere else, so it inherits that job's rebuild trigger, reconciliation
   sweep and idempotency instead of growing its own staleness modes. Rows are
   replaced wholesale per page: there is no incremental state to drift, and a
   full rebuild converges rather than accumulating.
2. ✅ **Page links** *(2026-08-11)* — both halves the gate promised. The
   backlink query is `GET /pages/:id/backlinks`, filtered per referring page by
   the caller's read access (a backlink discloses a title, so VIEW on the
   target is not enough). Stale labels are resolved **on the projection**:
   `resolvePageLinkTitles` substitutes each target's current title before
   `rendered_html` and `text_extract` are generated, while `document_json` and
   the Y.Doc keep the label the editor authored. That keeps the static renderer
   a pure JSON→HTML function with no database lookup on the read path, and
   keeps `onStoreDocument` the only writer of `page.title`.
   **Termination is the load-bearing detail:** each row records the label *as
   rendered*, and a rename only enqueues referrers whose recorded label differs.
   Refreshing referrers unconditionally would cascade through the link graph
   and two pages linking to each other would never settle.
   **Editor labels** *(closed 2026-08-13)* — the editor renders the Y.Doc, so
   the projection cannot reach it; the node itself has to be rewritten. The
   sketched fix (a `relabel` command per referrer) was not built, for two
   reasons found on contact. Driven off `findStaleReferrers` it fires only for
   *future* renames — every link that already exists has a correct projection
   and a stale Y.Doc, so the whole V1 backlog would have been skipped. And
   per-referrer fan-out costs a Y.Doc load, a revision checkpoint and a
   projection rebuild for every referring page, per rename. What shipped
   instead: `onLoadDocument` repairs labels as documents open, which is
   self-healing and covers the backlog, and one `relabel` command naming the
   renamed *page* lets realtime rewrite the documents currently open by
   intersecting with its own set — the space-scoped-event shape from ADR 0008.
   The invariant that makes load-time repair free: relabelling a document
   whose labels are already right must produce no Yjs update at all.
3. ✅ **Mentions** *(2026-08-13)* — the second `RefKind`, and the one that
   proved the shape generalises: a `mention` node (inline atom), an `@` picker
   beside the slash palette, `MENTION` rows on `target_user_id`, and a
   space-scoped Mentions list reusing the Recent/Starred component wholesale.

   Adding it turned the page-link-specific label machinery into a general one
   (`resolveRefLabels`, `relabelReferences`), because a mention caches a
   display name for exactly the reason a link caches a title — the static
   renderer must not query a database — and would otherwise have reintroduced
   the staleness bug that had just been fixed, in a second place.

   `ord` is one document-order sequence across kinds, not one per kind: it is
   half the primary key, so per-kind numbering would collide.

4. ✅ **Tasks** *(2026-08-13)* — the kind that retroactively justifies the
   gate's answer. A to-do is the one consumer that reads a row's *body* rather
   than what it points at, so under the rejected (page, entity) shape two
   to-dos on a page would have been one row with nowhere to put either text or
   done-state. `payload` carries `{label, done}`; the board is space-scoped and
   read-only, because a checkbox there would have to write back into the Y.Doc
   and making the projection an edit target is what hard rule 2 forbids.

   Assignment reuses `target_user_id` rather than adding a column: the first
   person named inside a task is its assignee, so "assigned to me" is an
   indexed lookup. Everyone else named still gets their own MENTION row, so
   nothing is lost — and `kind` is what keeps the two queries apart, since both
   populate the same column.

**H1 is complete**: three kinds indexed, four consumers built. H2, the inbox
and — since H5 — databases, comments and the operational debt are closed too.
What is left in V2 is H4: items waiting on a reason.

**Hard rule it must not break:** rule 2 forbids a block *relational* table.
`block_index` is a projection — derived, disposable, rebuildable from the
Y.Doc, never a source of truth and never written by the editor. If it ever
becomes the thing an edit writes to, the rule has been broken. Rebuilding it
from scratch for every page must stay a supported operation.

### H2 · Adoption path (independent of H1, parallelisable) — complete

- ✅ **Page templates** *(2026-08-14)* — cheap next to the rest, and the thing
  that makes an empty workspace usable.
- ✅ **Markdown export, then import** *(2026-08-14)* — two one-directional
  flows (ADR 0005), built adjacent exactly as this section warned, so the
  Markdown→Y.Doc path exists once.
- ✅ **Confluence/Notion importer** *(2026-08-14)* — the migration path for
  teams adopting Angy, and the item the roadmap ranks highest outside the
  structural work. It is a front end on the bundle importer rather than a
  second importer: `unpackArchive` turns a `.zip` into the same
  `{path, markdown}` plus its media, and `importBundle` does the rest.

  Three things were decided on contact:

  1. **Ids before writes.** The plan phase assigns every page's id, title, slug
     and parent before a row exists, because an export's links point forward as
     often as back — a one-pass loop can only rewrite links to pages it has
     already created, and the rest stay relative paths to files that no longer
     exist. `createPage` grew an optional `id` for this.
  2. **Links become hrefs, not `pageLink` nodes.** `pageLink` is a block-level
     atom, so promoting an inline link would mean rewriting the paragraph
     around it and discarding the author's link text. Imported links resolve
     through `/p/{id}` and work; they do not produce backlinks. A node that
     swallows its own sentence would be the worse trade.
  3. **Bound the archive before inflating it.** Each zip entry header states
     its uncompressed size, so a bomb is refused without being allocated. A
     check after unzipping is a check the API has already lost.

  Markdown exports only. A Confluence *HTML* export is refused with a reason
  rather than half-parsed: HTML→ProseMirror is a second engine, not a flag.

### H3 · Waiting on H1

- ✅ **Backlinks + mentions UI**, then **per-user mention notifications and the
  in-app inbox** *(2026-08-14)* — the inbox had no reason to exist before
  mentions did.
- ✅ **Databases-in-pages** (ADR 0013) — built in H5.3 below, as the ADR's
  first slice: a row is a Page, a database is a view over a page's children
  plus a property schema. `page_property` is new relational data and is *not* a
  block table — properties are page metadata.

### H4 · On demand only

Each of these is a real V2 item with no dependency and no pull yet. Building
any of them before something asks for it is speculative:

- **GraphQL API** — roadmap says "when a consumer needs it". There is no second
  consumer; REST is the whole surface.
- **SCIM provisioning** — rides Authentik's outbound provider (ADR 0011). E2
  already refuses unknown-email invites with "SCIM is V2" rather than failing
  silently, so the seam exists.
- **Confluence-style macros**, **federated search connectors**, **PDF/Word
  export**, **per-line authorship**, **extension manager**.

**Comments** sit in V3 in the roadmap but are flagged there as a strong V2
candidate. They are genuinely independent of `block_index` (a comment anchors
to a page and a position, not to an indexed block), so they can be pulled
forward without disturbing H1.

### H5 · The wave that closed the rest of V2 *(2026-08-17)*

> H1–H3 left three things: the structural item (databases), the one V3 feature
> the roadmap kept flagging as a V2 candidate (comments), and operational debt
> that ADR 0013's own sequencing clause made a *precondition* for the
> structural item. H5 is those three plus the ordering primitive both of the
> first two turned out to need.

**Order was the hidden prerequisite.** ADR 0013 named "ordering across a view"
as unsolved, and the audit that opened this wave found it was worse than that:
sibling order did not exist at all. `spaces.controller.ts` sorted by
`created_at` and `pageSubtree.sql` by `depth, created_at`, so nobody could put
the overview above the appendix without deleting and recreating it. That is one
gap serving two features, and it went first.

- ✅ **H5.1 · Sibling ordering** — `page.ord`, a fractional index
  (`orderKeyBetween` in @angy/shared). Reordering one page updates one row and
  never renumbers its siblings, and two people dropping a page into the same
  slot compute the *same key* rather than overwriting each other's shifts —
  a tie, resolved identically for everyone by sorting `(ord, id)`.

  Three things were decided on contact:

  1. **`COLLATE "C"` is load-bearing.** The keys mix digits with both letter
     cases and a `.` separator, and a locale collation folds case and ignores
     punctuation — under `en_US.UTF-8` Postgres orders `V00001.l` and `V00002`
     differently from the code that computed them, and the tree comes back
     subtly shuffled on one deployment and not another.
  2. **A fixed-width integer part, then a fraction.** Appending increments the
     integer, so the common case stays six characters forever; only repeatedly
     inserting between the same two rows grows a key, one character per split.
     A pure fraction would have grown a character every few appends.
  3. **Reorder is not move.** `POST /pages/:id/order` touches one row and no
     closure, permission or media path; reparenting stays with `move`, which
     needs all of them. A drag in the sidebar should not pay for the ones it
     does not use. The anchor is a sibling *id*, never an index: the client's
     list is a render of a tree anyone else may have changed.

- ✅ **H5.2 · Comments** *(ADR 0014)* — pulled forward from V3, where the
  roadmap had already flagged them as a strong V2 candidate. The dependency
  argument for deferring them was never real (a comment anchors to a page and a
  position, not to an indexed node), and H3's inbox made the notification half
  nearly free: `COMMENT` is a new enum value, not a subsystem.

  **The anchor is a mark in the Y.Doc; the thread is relational.** A mark *is*
  a position expressed in the only coordinate system that survives concurrent
  editing — the text itself — so Yjs solves the anchoring problem for free.

  The load-bearing consequence: **no comment action except opening a thread
  writes to the document.** Replying, resolving and deleting are relational, so
  none of them produce a Yjs update, a revision checkpoint, an S3 write or a
  projection rebuild. A page's history should record edits, not conversations.
  It follows that a mark can outlive its thread, so **a mark whose thread is
  gone renders as plain text** — which is also why the reader emits one CSS
  rule per live thread instead of rewriting the article's HTML.

  The mirror case is the worker's: `rebuildProjection` already walks the
  document, so it flags a thread whose mark has vanished rather than letting
  the conversation disappear with the sentence.

- ✅ **H5.3 · Databases-in-pages, first slice** *(ADR 0013)* — page properties
  per space, typed values per page, and one **read-only** table view over a
  page's children. No boards, calendars, relations or rollups: those sit
  downstream of whether this property model survives real data.

  1. **Typed columns, not a JSON blob.** The ADR rejected building this on a
     scan filtered in application code; typed columns are what let a filter be
     `WHERE number_value > 4` — an index away from fast — rather than a cast
     over JSONB. It is also what makes `"8" < "10"` a non-problem.
  2. **The view renders outside `rendered_html`.** The static renderer is a
     pure JSON→HTML function and must not query a database, so a database
     *block* could never carry live rows. The table is its own server-rendered
     section after the article, which keeps the invariant and still ships no
     JavaScript to the read path.
  3. **Cells are edited on the row's own page, never in the table.** A view
     that writes back is a projection being edited, which is what hard rule 2
     exists to prevent.
  4. **Sorting is in application code, filtering is not.** Ordering by a
     to-many relation is not something Prisma expresses, and hand-built dynamic
     SQL for a set already bounded by one page's children is the worse trade —
     so the filter runs in SQL, the sort runs over the filtered rows, and
     `total` reports what matched while `rows` is what fits
     (`DATABASE_ROW_LIMIT`).

  Two bugs the tests caught rather than the reviewer: blank cells sorted
  *first* under a descending sort (the direction flip was negating the
  null-handling too), and the multi-sort that depended on it.

- ✅ **H5.0 · Operational close-out** — ADR 0013's sequencing clause makes this
  a precondition, not hygiene: "a feature of this size built on an install
  whose backups have never been tested is the wrong order of work".

  - **PITR** — `walreceiver` streams the WAL continuously into its own volume
    and `./backup.sh --base` takes the weekly physical base backup it replays
    onto. A *receiver*, not an `archive_command`: the archive directory would
    be a root-owned named volume the postgres user cannot write to, so the
    archive fails silently and WAL piles up until the disk fills.
    Procedure and the replication slot's sharp edge: runbooks/pitr.md.
  - **Alerts reach a human** — `infra/alert-relay.sh`. The alerts runbook
    described a "log pipeline" that paged on `[alert]` lines. There was no
    pipeline: the lines were printed and nothing read them, so every signal in
    that runbook was visible only to someone already tailing the logs. On the
    host under systemd rather than in a container, because reading other
    containers' logs means mounting the Docker socket, which is handing out
    root.
  - **Rotation** — `infra/verify-secrets.sh`. The procedure existed and had
    never been run, and the reason it kept not happening is that there was no
    way to tell whether it had worked short of waiting for a complaint. The
    script asks the running stack, not the config file — and compares
    `JWT_SECRET` *between api and realtime*, which is the failure rotation
    actually introduces. **Executing the rotation is still outstanding**: it
    runs against the live deployment.
  - **Still open:** the replica is on the same LAN. Closing that is a decision
    about where a third copy lives, not a change to `backup.sh`.

### Operational work, carried from V1

Not features — mostly closed by H5.0 above. What genuinely remains:

- ✅ ~~snapshots are not PITR~~ — H5.0: `walreceiver` + `./backup.sh --base`.
- **Backups reach a NAS but not another site.** That covers a failed disk and a
  bad migration, not a failed room. The gap is a decision about where a third
  copy lives.
- ✅ ~~alerts reach nobody~~ — H5.0: `infra/alert-relay.sh`.
- **No deployment secret has ever been rotated**, and several were typed in
  plaintext during setup. Procedure: runbooks/key-rotation.md; proof that a
  rotation worked: `infra/verify-secrets.sh`. **This one needs hands on the
  live deployment and is the oldest outstanding item in the repo.**
- **The e2e suite is timing-sensitive under load.** `retries: 0` stays, and H5
  settled why rather than revisiting it: the flake that motivated the question
  turned out to be a *bug* (the streaming-locator race, fixed by
  `articleBody()`), which silent retries would have hidden for months. The
  policy is therefore "retry the commit, not the test" — a green re-run of the
  identical commit is the evidence that separates a flake from a regression,
  and it stays a manual, visible act.
