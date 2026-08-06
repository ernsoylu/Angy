# TODO — Remaining Work Tracker

> Actionable checklist distilled from [implementation-plan.md § Open gaps and § V2 sequencing](implementation-plan.md). V1 (phases 0–10) plus waves A–D, F, and E1–E2 shipped as of 2026-08-06 — 80 unit/integration + 29 e2e tests green. Check items off here; keep the plan's narrative in sync when a wave completes.

## Decision gates (answer before the dependent wave starts)

- [x] ~~**Space-settings screen design**~~ — frames 12 (Space Settings) and 13 (Create Space) now exist in frontend.pen, light and dark. Four things in them still need a human's yes/no before E2/E3 can be built: whether the space key is immutable, whether deleting a space is a real soft-delete state, whether an Owner tier above Admin exists, and whether member edits apply instantly while identity/visibility are staged behind Save
- [x] ~~**Tag semantics**~~ — freeform authoring with admin cleanup, workspace-wide namespace (Wave D shipped on this)
- [ ] **Multi-IdP** — real requirement, or remove the decorative Authentik button? (gates E4)
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

## Wave E — Administration & auth *(E1–E2 done; E3 needs the frame-12 answers, E4 the IdP call)*

- [x] E1 · Space-wide permission-bitmap invalidation. The published event names the **space**, not its pages: a space holds thousands while the realtime tier only cares about the handful currently open, so realtime resolves it against the open document set. Keeps the message size and the work proportional to live sessions, not to the space
- [x] E2 · Space CRUD + member management (ADMIN-gated): create (creator becomes first admin), update name/description/visibility/baseline, list/invite/change-level/remove members. Visibility and baseline changes trigger E1; a rename does not. Two guards worth keeping: a space can never lose its last admin, and inviting an unknown email explains that SCIM is V2 rather than failing silently
- [ ] E3 · Space-settings screen (frame 12) + create-space flow (frame 13); wire the dead "New page" header and "Space settings" buttons — **needs the four frame-12 answers, chiefly the save model**
- [ ] E4 · Config-driven multi-IdP (`?provider=` on `/auth/login`) — or remove the second button

## Wave F — Deep editor ✅ *(2026-08-06)*

- [x] F1 · Collaborative title: a `title` Y.Text beside the body in the same Y.Doc; the editor input binds to it through `applyTextDiff` (prefix/suffix matching, so concurrent edits survive); `onStoreDocument` copies it into `page.title`; `PATCH /pages/:id` publishes a `rename` doc command instead of writing the row. Docs predating the field are seeded once from `page.title` on load, and an emptied title never reaches Postgres

## Wave G — Cloud *(last; after A3 + provider gate)*

- [ ] G1 · Terraform: bucket, CDN, DNS
- [ ] G2 · CloudFront edge-signed cookies for `media-private/*` (ADR 0007), replacing S3 presigning in production config (rotation already covered in runbooks/key-rotation.md)

## Accepted deviations (not TODO — recorded so they aren't re-litigated)

- Search-token TTL is a flat 15 minutes; ADR 0009's "session refresh interval" binding has no refresh concept to attach to.
- Dev/prod media access classes are storage prefixes (`media/` vs `media-private/`); the CDN tier supersedes the anonymous-read bucket policy in production (Wave G).
- The pruned runtime tree keeps `typescript` and the full `@prisma/client` engine set (~97 MB of the 602 MB). Both arrive as optional peers of production dependencies; trimming them means pruning inside the store, which is more fragile than the size is worth.
- Recent and Starred are **space-scoped routes**, not expanding sidebar trays. No frame specifies either surface; routing matches the sibling rows in the same nav group (Home, Attachments, Trash) and gives the Me tab something to link to.

**Critical path with full parallelism:** ~~A1~~ → (~~B~~, ~~C~~, ~~F~~) → ~~D~~ → ~~E1–E2~~ → E3/E4 → G. Everything that can be built without a human decision now is. What is left: **E3** (the settings UI — needs the four frame-12 answers), **E4** (multi-IdP: real or remove the button), **G** (cloud provider), and the small standalone items in the plan's § Open gaps.
