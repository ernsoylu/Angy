# TODO — Remaining Work Tracker

> Actionable checklist distilled from [implementation-plan.md § Open gaps and § V2 sequencing](implementation-plan.md). V1 (phases 0–10) plus waves A–F shipped as of 2026-08-06 — 80 unit/integration + 35 e2e tests green. Check items off here; keep the plan's narrative in sync when a wave completes.

## Decision gates (answer before the dependent wave starts)

- [x] ~~**Space-settings screen design**~~ — frames 12 (Space Settings) and 13 (Create Space) now exist in frontend.pen, light and dark. Four things in them still need a human's yes/no before E2/E3 can be built: whether the space key is immutable, whether deleting a space is a real soft-delete state, whether an Owner tier above Admin exists, and whether member edits apply instantly while identity/visibility are staged behind Save
- [x] ~~**Tag semantics**~~ — freeform authoring with admin cleanup, workspace-wide namespace (Wave D shipped on this)
- [x] ~~**Multi-IdP**~~ — **not a requirement**: one IdP, and it is Authentik (ADR 0011). The second sign-in button is gone rather than wired up
- [ ] **Cloud provider** — for terraform + CDN (gates Wave G)

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
reached through Pangolin tunnels. What the goal actually decomposes into:

- [ ] G1 · Ingress: Pangolin/newt tunnel to the three HTTP tiers, with the realtime WebSocket tier proven to survive it (ADR 0008 needs sticky sessions and long-lived upgrades — the thing most likely to break through a tunnel)
- [ ] G2 · Public origin config: `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_REALTIME_URL` are baked at image build (see docs/env.md), so the tunnel hostnames must be known before the web image is built
- [ ] G3 · Private-space media without a CDN: ADR 0007 assumed CloudFront edge-signed cookies. Behind a tunnel the options are S3/MinIO presigning (already implemented) or serving through the app — needs an ADR amendment either way
- [ ] G4 · Persistence and backup on the homelab: Postgres PITR, MinIO durability, and where the Y.Doc blobs actually live
- [ ] G5 · Whether terraform earns its place at all here, or whether compose/k8s manifests plus the existing `infra/k8s/rehearse.sh` are the honest tool

## Accepted deviations (not TODO — recorded so they aren't re-litigated)

- Search-token TTL is a flat 15 minutes; ADR 0009's "session refresh interval" binding has no refresh concept to attach to.
- Dev/prod media access classes are storage prefixes (`media/` vs `media-private/`); the CDN tier supersedes the anonymous-read bucket policy in production (Wave G).
- The pruned runtime tree keeps `typescript` and the full `@prisma/client` engine set (~97 MB of the 602 MB). Both arrive as optional peers of production dependencies; trimming them means pruning inside the store, which is more fragile than the size is worth.
- Recent and Starred are **space-scoped routes**, not expanding sidebar trays. No frame specifies either surface; routing matches the sibling rows in the same nav group (Home, Attachments, Trash) and gives the Me tab something to link to.
- Tag admin lives in *space* settings even though tags are workspace-wide — it is the only admin surface there is. A workspace-settings screen would be its proper home if one is ever designed.
- Unused tags are swept by the GC rather than kept: freeform authoring means the vocabulary only grows otherwise, and an orphan name blocks renaming onto it.

**Critical path:** ~~A1~~ → (~~B~~, ~~C~~, ~~F~~) → ~~D~~ → ~~E~~ → G.

Waves A through F are done. **Wave G is all that remains**, and it is now a
homelab-and-tunnel problem rather than a cloud one — G1 (does the WebSocket
tier survive Pangolin) and G3 (private media without a CDN) are the two that
could force real code changes; the rest is configuration.
