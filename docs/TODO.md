# TODO — Remaining Work Tracker

> Actionable checklist distilled from [implementation-plan.md](implementation-plan.md) § Open gaps and § Post-V1 burn-down. V1 (phases 0–10) and waves A–G are shipped and deployed — 91 unit/integration + 39 e2e tests green. Check items off here; keep the plan's narrative in sync when a wave completes. What comes next lives in [§ V2](implementation-plan.md#v2), not here.

## Decision gates (answer before the dependent wave starts)

- [x] ~~**Space-settings screen design**~~ — frames 12 (Space Settings) and 13 (Create Space) now exist in frontend.pen, light and dark. Four things in them still need a human's yes/no before E2/E3 can be built: whether the space key is immutable, whether deleting a space is a real soft-delete state, whether an Owner tier above Admin exists, and whether member edits apply instantly while identity/visibility are staged behind Save
- [x] ~~**Tag semantics**~~ — freeform authoring with admin cleanup, workspace-wide namespace (Wave D shipped on this)
- [x] ~~**Multi-IdP**~~ — **not a requirement**: one IdP, and it is Authentik (ADR 0011). The second sign-in button is gone rather than wired up
- [x] ~~**Cloud provider**~~ — **moot**: Wave G went to the homelab behind a Pangolin tunnel (ADR 0012), so there is no cloud region, no CDN and no terraform to choose a provider for. Revisit only if a second deployment target appears

## Wave A — Foundations ✅ *(2026-08-06)*

- [x] A1 · e2e in CI: an `e2e` job runs `docker compose up` for the four backing services (Actions `services:` can't override MinIO's entrypoint), boots all four apps from their production builds, and runs Playwright; app logs + traces upload on failure
- [x] A2 · Image slimming: `infra/docker/prune.sh` — `pnpm deploy --prod --legacy` with `node-linker=hoisted`, `dist/` copied in by hand (the packer falls back to the root `.gitignore`), then a second `prisma generate --sql` in the pruned tree. 1.5 GB → 602 MB (api/worker), 578 MB (realtime), 509 MB (web)
- [x] A3 · Deploy rehearsal: `infra/k8s/rehearse.sh` creates a kind cluster, loads the images, mints a real `angy-env` Secret, applies `angy.yaml`, waits on all four rollouts, and smoke-tests `/health` + the SSR read path from inside the cluster. Two deploy bugs fell out of it — missing `imagePullPolicy` (every pod `ErrImagePull` on a clean cluster) and `NEXT_PUBLIC_*` being build-time, not Secret-time

## Wave B — Independent polish ✅ *(2026-08-06)*

- [x] B1 · Link UI in the bubble menu — URL field swaps in over the mark buttons; `shouldShow` keeps the menu up while the field has focus
- [x] B2 · Table row/column controls + delete-table — own toolbar, shown while the caret is inside a table
- [x] B3 · `+` block inserter and `⠿` drag handles (`@tiptap/extension-drag-handle-react`; `+` inserts a paragraph containing "/" so the palette stays the single block registry)
- [x] B4 · Attachment "Used on N pages" — space attachments grouped by sha256, every page linked from the detail rail
- [x] B5 · Page-tree arrow-key traversal — `PageTree` with roving tabindex (↑↓ → ← Enter · Home/End)
- [x] B6 · Compact density preference — `data-density` on `<html>`, `--row-h`/`--row-font` tokens, account-menu toggle, ignored at the touch breakpoint
- [x] B7 · Mobile tab bar: Search and Page routed with live active states ("Me" stays disabled until C3)

## Wave C — Per-user models ✅ *(2026-08-06)*

- [x] C1 · `page_visit` + `page_star` migration; the visit write is a throttled conditional upsert in Postgres (`prisma/sql/recordPageVisit.sql`) called from the reader's RSC render — no Redis hop, no write per reload; star toggle in the page-info rail
- [x] C2 · Recent + Starred as space-scoped routes off the sidebar's existing nav rows, sharing one list component with the design-system empty state
- [x] C3 · Mobile "Me" tab: profile, both lists, sign-out — frame E's tab bar is now fully wired

## Wave D — Search surfaces ✅ *(2026-08-06)*

**Gate answered:** tags are **freeform with admin cleanup**, in a **workspace-wide** namespace.

- [x] D1 · `tag` + `page_tag`; names normalised on write (`normalizeTag` in shared — case-folded, hyphenated, unicode-preserving, filter-literal-safe) so near-misses collapse instead of accumulating. EDIT-gated chips on the reader byline with typeahead; `tags` indexed as searchable *and* facetable; Tags facet in the rail (frame 3 order: Spaces → Updated → Tags)
- [x] D1-admin · Rename and merge, each requiring **ADMIN on every space the tag appears in** — the namespace is shared, so anything looser would let one space's admin rewrite a label another space depends on. API-only for now; the UI lands with E3's settings screen, which is where it has a designed home
- [x] D2 · `attachments` Meilisearch index (space_id/page_id/kind filterable); one tenant token now carries the same read filter for **both** indexes — an attachment is exactly as readable as the page it hangs off. Functional Attachments tab, with the guardrailed proxy path saying so rather than silently returning nothing

## Wave E — Administration & auth ✅ *(2026-08-06)*

**Gates answered:** members apply instantly while identity/access stage behind Save; deleting a space is a 30-day soft delete; there is **no Owner tier** — ADMIN is the top, and the settings screen itself is the restricted surface.

- [x] E1 · Space-wide permission-bitmap invalidation. The published event names the **space**, not its pages: a space holds thousands while the realtime tier only cares about the handful currently open, so realtime resolves it against the open document set. Keeps the message size and the work proportional to live sessions, not to the space
- [x] E2 · Space CRUD + member management (ADMIN-gated): create (creator becomes first admin), update name/description/visibility/baseline, list/invite/change-level/remove members. Visibility and baseline changes trigger E1; a rename does not. Two guards worth keeping: a space can never lose its last admin, and inviting an unknown email explains that SCIM is V2 rather than failing silently
- [x] E3 · Space-settings screen (frame 12), ADMIN-gated with frame 11's restricted state as the whole-screen answer. Identity and access stage behind Save; member changes apply on click — pretending otherwise would misreport what the server has already done. Space soft-delete lands with it (`space.deleted_at`, 30 days, mirroring page trash): the space leaves every listing and its pages leave both search indexes immediately, while its own pages keep their `deleted_at` untouched so a restore returns exactly what was live. Both space-home buttons are wired
- [x] E4 · Authentik replaces Keycloak as the single IdP (ADR 0011). `infra/authentik/blueprints/angy.yaml` is the declarative dev config the realm import used to be — provider, application, group and seed users, reapplied on every worker start. The sign-in screen shows one button, because there was only ever one provider behind both
- [x] E3-follow-up · Create-space dialog (frame 13) with a key derived from the name; tag rename/merge now lives in the settings screen

## Wave F — Deep editor ✅ *(2026-08-06)*

- [x] F1 · Collaborative title: a `title` Y.Text beside the body in the same Y.Doc; the editor input binds to it through `applyTextDiff` (prefix/suffix matching, so concurrent edits survive); `onStoreDocument` copies it into `page.title`; `PATCH /pages/:id` publishes a `rename` doc command instead of writing the row. Docs predating the field are seeded once from `page.title` on load, and an emptied title never reaches Postgres

## Wave G — Homelab deployment *(reshaped 2026-08-06: homelab + Pangolin, not cloud)*

The original wave assumed a cloud provider, terraform for bucket/CDN/DNS, and
CloudFront signed cookies. None of that applies to a self-hosted homelab
reached through Pangolin tunnels. Topology decided in **ADR 0012** — five
public hostnames, tunnel as sole ingress. Procedure:
**docs/runbooks/homelab.md**.

- [x] **G0 · Tunnel-hostile assumptions in the code** *(2026-08-06)* — an audit found five places where "internal", "public" and "what the browser uses" had been collapsed into one address. Two were blockers: the OIDC `redirect_uri` and the callback URL were built from `http://localhost:${env.port}`, so sign-in would have redirected users to a host that does not exist. Fixed via `PUBLIC_API_URL`, which also drives the session cookie's `Secure` flag.
- [x] **G2 · Public origin config** *(2026-08-06)* — `infra/docker/build.sh` already takes the two `NEXT_PUBLIC_*` values as build args; the runbook records that the web image is therefore environment-specific and cannot be promoted across deployments.
- [x] **G3 · Media without a CDN** *(2026-08-06)* — decided in favour of exposing MinIO as `media.angy.<domain>`, a fifth public hostname (ADR 0007 amendment). This required the `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` split: SigV4 signs the Host header, so presigning must happen against the public origin while all SDK traffic stays internal.
- [x] **G1 · WebSocket tier survives the tunnel** *(2026-08-06, verified against the live deployment)* — upgrade completes in 0.24s; an idle connection held 60s and was then closed by Hocuspocus itself with `4408 Connection Timeout`. The close **code** is the evidence, not the duration: a proxy reaping an idle upgrade produces `1006` with no close frame, so a clean application-level 4408 proves the tunnel carried the connection for its full lifetime. Procedure: runbooks/homelab.md §5.1.
- [x] **G4 · Persistence and backup** *(2026-08-07)* — `infra/backup.sh` dumps both Postgres databases and archives the object store, on a daily cron with a **weekly restore drill**. Drilled against the live deployment: the dump restored into a throwaway container and the row counts matched the manifest exactly. Postgres alone would not have been a backup — it holds pointers into object storage, so restoring it without the bucket yields a full page tree of empty pages. Snapshots are replicated to a SMB share at `/mnt/Backups` (60-day retention there, 14 locally); a missing mount fails the run rather than silently degrading to local-only. **Still open:** snapshots are not PITR, and the share is on the same LAN — that covers a disk, not the room.
- [x] **G5 · Terraform does not earn its place** *(2026-08-07)* — **no**. There is no cloud account, no CDN and no DNS zone to manage: the whole infrastructure is one compose file, five Pangolin resources clicked once, and a connector. Terraform would describe a VPS it does not own. `infra/compose.prod.yml` covers the homelab and `infra/k8s/rehearse.sh` covers the k8s path. Revisit only if a second deployment target appears.

**Not blocking, worth knowing:** Pangolin's Integration API listens on port
3003 (not 443) behind `flags.enable_integration_api`, and was unreachable from
outside during setup — so the site and its five resources get created through
the dashboard rather than scripted.

## Accepted deviations (not TODO — recorded so they aren't re-litigated)

- Search-token TTL is a flat 15 minutes; ADR 0009's "session refresh interval" binding has no refresh concept to attach to.
- Dev/prod media access classes are storage prefixes (`media/` vs `media-private/`). In the homelab there is no CDN tier to supersede the anonymous-read policy on `media/` — tunnel-exposed MinIO takes its place, so public-space media is internet-readable by design (ADR 0007 amendment).
- The pruned runtime tree keeps `typescript` and the full `@prisma/client` engine set (~97 MB of the 602 MB). Both arrive as optional peers of production dependencies; trimming them means pruning inside the store, which is more fragile than the size is worth.
- Recent and Starred are **space-scoped routes**, not expanding sidebar trays. No frame specifies either surface; routing matches the sibling rows in the same nav group (Home, Attachments, Trash) and gives the Me tab something to link to.
- Tag admin lives in *space* settings even though tags are workspace-wide — it is the only admin surface there is. A workspace-settings screen would be its proper home if one is ever designed.
- Unused tags are swept by the GC rather than kept: freeform authoring means the vocabulary only grows otherwise, and an orphan name blocks renaming onto it.

**Critical path:** ~~A1~~ → (~~B~~, ~~C~~, ~~F~~) → ~~D~~ → ~~E~~ → ~~G~~.

**V1 is complete and deployed.** Waves A–G are closed. The stack runs on the
homelab behind a Pangolin tunnel, serving six public hostnames alongside
Forgejo on the same identity provider; sign-in, collaborative editing, search,
media and page history all work end to end against the live deployment, and the
backup is drilled rather than merely written down.

What is genuinely open is operational, not architectural:

- **Backups reach a NAS but not another site.** That covers a failed disk, not
  a failed room; and snapshots are not point-in-time recovery.
- **Credential rotation** — the deployment secrets generated during setup have
  never been rotated, and several were typed in plaintext while it was built.
- **No production seed by design.** A new workspace starts genuinely empty, so
  first-run paths are load-bearing in a way development never exercises. Two
  V1-blocking defects hid there (an empty space list read as signed-out; the
  only button out of an empty space was wired to nothing), which is a reason to
  keep exercising them.

- **e2e flakiness — diagnosed and largely closed.** Four local runs of one
  commit gave 39, 37, 38 and 39 passes, failing a *different* test each time,
  and GitHub's e2e failed a commit Forgejo's passed. The cause was not load:
  the reader is streamed, so a bare `.article-prose` locator transiently
  matched two nodes (the real one and React's hidden `id="S:…"` template) and
  died with "resolved to 2 elements" — measured at 2 in 40 navigations. Fixed
  by `articleBody()` in `e2e/helpers.ts`; 3 of 3 full runs green after.
  `retries: 0` stays deliberate, so any one flake still reds the build — which
  keeps "re-run the same commit" the cheapest first diagnostic before reading a
  failure as a regression.

## Post-V1 hardening *(2026-08-11)*

Closed after a status audit found `main` red for four days:

- [x] **Lint on `main`** — `e2e/assert-fresh-server.mjs` is the repo's only
  non-TS source file, and `no-undef` fires there because the flat config
  declares no environment (TS files escape the rule through typescript-eslint's
  overrides). Node globals now declared for `**/*.{mjs,cjs}`.
- [x] **`onStoreDocument` pinned documents for deleted pages** — `page.update`
  throws P2025 when the row is gone, and Hocuspocus answers a failed store by
  keeping the document in memory "to avoid data loss", replaying the same
  failing write on every debounce. A page can legitimately vanish under an open
  socket (trash purge, space purge). `updateMany` + a count check; covered by
  `apps/realtime/test/store.test.ts`, verified by reintroducing the bug.
- [x] **The e2e harness addressed a different Redis than the apps** —
  `global-setup` and `helpers` fall back to `redis://localhost:6379`, while
  every app reads `REDIS_URL` from the root `.env.local`. When those disagree
  the planted sessions land in another server and *every* test fails with a
  redirect to `/signin` and no hint why. `playwright.config.ts` now loads the
  same file (`process.loadEnvFile`, which leaves shell exports winning).
- [x] **Two realtime test files bound the same port** — harmless only because
  `vitest.config.ts` sets `fileParallelism: false`, which is a statement about
  processes, not ports.

Next feature work is V2, planned in
[implementation-plan.md § V2](implementation-plan.md#v2).

## V2 · H1 — `block_index` *(started 2026-08-11)*

The gate everything else waited on. Granularity settled as **one row per
actionable node** — see the plan for why neither shape the gate named survived
all four consumers.

- [x] **Schema + worker** — `block_index` written by `rebuildProjection` and
  nowhere else, so it inherits the rebuild trigger, the reconcile sweep and the
  idempotency the other projections already have.
- [x] **Page links** — `GET /pages/:id/backlinks` (read-filtered per referring
  page), and stale link labels resolved on the projection so the reader is
  fresh while the Y.Doc keeps what the editor authored.
- [x] **Relabel the referring Y.Docs** *(2026-08-13)* — done, but **not** as
  "a `relabel` command per referrer" as sketched. Driven off `findStaleReferrers`
  that design only ever fires for *future* renames: every link that already
  exists has a correct projection and a stale Y.Doc, so it would have left the
  entire V1 backlog untouched. And per-referrer fan-out costs one Y.Doc load,
  revision checkpoint and projection rebuild per referring page per rename.
  Instead: `onLoadDocument` repairs labels as documents open — self-healing,
  covers the backlog, costs one CRDT walk and no query when a doc has no links
  — and one `relabel` command naming the renamed *page* lets realtime fix the
  documents that are open right now. The two together leave no case uncovered.
- [x] **Backlinks UI** *(2026-08-13)* — a "Linked from" rail group on the
  reader, server-rendered with the rest of the rail so no JS enters the read
  path. It owns the limit, as planned: 8 rows and then "and N more", counted
  *after* the read filter so the overflow never includes pages the reader
  cannot open. `filterReadablePages` resolves the whole candidate set in one
  query — a round trip per candidate is what makes a list surface slow.
- [x] **Mentions** *(2026-08-13)* — a `mention` node (inline atom), an `@`
  picker beside the slash palette, `MENTION` rows keyed on `target_user_id`,
  and a space-scoped Mentions list reusing the Recent/Starred component. The
  cached display name is repaired by the same two paths page-link titles are,
  because a second cached label would otherwise reintroduce the staleness bug
  that had just been fixed.
- [x] **Tasks** *(2026-08-13)* — `/todo` checklists, `TASK` rows carrying
  `{label, done}`, and a space-scoped board grouped by page. The board is
  read-only on purpose: a checkbox there would have to write back into the
  page's Y.Doc, and making the projection the thing an edit writes to is
  exactly what hard rule 2 forbids. Assignment rides the mention already in the
  task — the first person named goes into `target_user_id`, so "assigned to me"
  is an indexed lookup rather than a scan, and everyone else named still gets
  their own mention row.

**H1 is complete.** All three kinds are indexed and all four consumers built.

## V2 · H2 — Adoption path

- [x] **Page templates** *(2026-08-14)* — a `page_template` table holding a
  snapshot of a page's `document_json`, applied through the existing
  `createPage(documentJson)` → `initYdoc` path so a templated page and a blank
  one come into existence identically. Save-as-template from the page rail,
  a picker in the New page dialog, ADMIN to delete. **Not** a Page with an
  `is_template` flag: that would have to be excluded from the tree, search,
  backlinks, trash, Recent, Starred and every future listing, and missing one
  leaks a template into a surface where it reads as real content.
- [ ] **Confluence/Notion importer** — the roadmap's highest-value
  non-structural item, and a multi-session one. Build it adjacent to Git import
  (ADR 0005) or the Markdown→Y.Doc path gets written twice.
- [ ] **Git import / Git export** — two one-directional flows.
- [ ] **Workspace-wide mention inbox + notifications** — the roadmap's item.
  The space-scoped list is deliberately not it: an inbox needs notifications
  behind it to be worth opening.
