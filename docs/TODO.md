# TODO — Remaining Work Tracker

> Actionable checklist distilled from [implementation-plan.md § Open gaps and § V2 sequencing](implementation-plan.md). V1 (phases 0–10) plus two burn-down waves shipped as of 2026-08-06 — 58 unit/integration + 13 e2e tests green. Check items off here; keep the plan's narrative in sync when a wave completes.

## Decision gates (answer before the dependent wave starts)

- [ ] **Space-settings screen design** — no frame exists in frontend.pen (gates Wave E)
- [ ] **Tag semantics** — freeform vs curated vocabulary (gates Wave D)
- [ ] **Multi-IdP** — real requirement, or remove the decorative Authentik button? (gates E4)
- [ ] **Cloud provider** — for terraform + CDN (gates Wave G)

## Wave A — Foundations *(start first; protects everything after)*

- [ ] A1 · e2e in CI: compose services as GitHub Actions services, boot the four apps, run the Playwright suite
- [ ] A2 · Image slimming: `pnpm deploy` runtime stages + second prisma generate pass (~1.5 GB → sane)
- [ ] A3 · Deploy rehearsal *(after A2)*: `kubectl apply` on kind/minikube with a real `angy-env` Secret; demo the V1 checklist on a clean cluster

## Wave B — Independent polish *(parallelize freely; no schema changes)*

- [ ] B1 · Link UI in the bubble menu (mark exists in schema)
- [ ] B2 · Table row/column controls + delete-table (commands already registered)
- [ ] B3 · `+` block inserter and `⠿` drag handles (frame 2; reuse `SLASH_ITEMS`)
- [ ] B4 · Attachment "Used on N pages" (group by sha256)
- [ ] B5 · Page-tree arrow-key traversal (frame D: ↑↓ move · → expand · ← collapse · Enter opens)
- [ ] B6 · Compact density preference (frame D; desktop-only, client-side setting)
- [ ] B7 · Mobile tab bar: wire Search and Page tabs (pure links)

## Wave C — Per-user models

- [ ] C1 · Migration: `page_visit` + `page_star`; throttled visit write on reader render; star toggle in the page-info rail
- [ ] C2 · Recent + Starred sidebar lists *(after C1)*
- [ ] C3 · Mobile "Me" tab: profile + sign-out + Recent/Starred lists *(after C2; completes frame E's tab bar)*

## Wave D — Search surfaces *(after tag-semantics gate; D1/D2 adjacent — both edit tenant-token searchRules)*

- [ ] D1 · Tags: `tag` + `page_tag` migration → EDIT-gated assignment UI (reader byline chips, frame 1) → `tags` index field → Tags facet (frame 3)
- [ ] D2 · Attachment search: `attachments` Meilisearch index (space_id/page_id filterable) → token searchRules across both indexes → functional Attachments tab (frame 3)

## Wave E — Administration & auth *(after settings-design + IdP gates)*

- [ ] E1 · **Prerequisite:** space-wide permission-bitmap invalidation (existing path is page-scoped only — membership has only ever changed via seed)
- [ ] E2 · Member management + space CRUD endpoints (ADMIN-gated) *(after E1)*
- [ ] E3 · Space-settings screen + create-space flow; wire the dead "New page" header and "Space settings" buttons *(after E2)*
- [ ] E4 · Config-driven multi-IdP (`?provider=` on `/auth/login`) — or remove the second button

## Wave F — Deep editor *(any time after A1; isolated but touches the store path)*

- [ ] F1 · Collaborative title: `title` Y.Text field in the page's Y.Doc, editor input bound to it, `onStoreDocument` syncs `page.title`, PATCH rename re-routed through the doc-command channel

## Wave G — Cloud *(last; after A3 + provider gate)*

- [ ] G1 · Terraform: bucket, CDN, DNS
- [ ] G2 · CloudFront edge-signed cookies for `media-private/*` (ADR 0007), replacing S3 presigning in production config (rotation already covered in runbooks/key-rotation.md)

## Accepted deviations (not TODO — recorded so they aren't re-litigated)

- Search-token TTL is a flat 15 minutes; ADR 0009's "session refresh interval" binding has no refresh concept to attach to.
- Dev/prod media access classes are storage prefixes (`media/` vs `media-private/`); the CDN tier supersedes the anonymous-read bucket policy in production (Wave G).

**Critical path with full parallelism:** A1 → (B, C, F) → D → E → G, with A2 → A3 alongside.
