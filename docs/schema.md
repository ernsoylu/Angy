# Database Schema — Table Inventory

> **DDL lives in [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma)** (migrations under `prisma/migrations/`). This file remains the spec-level inventory: table ownership and key columns. Conventions (CLAUDE.md): snake_case tables/columns; uuid for pages (gen_random_uuid), bigint identity for spaces/users/attachments.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `space` | Top-level container + permission baseline | `id` bigint PK, `key` (short slug, permanent — it is in every page URL, the search tenant filter and the bitmap prefix), `name`, `visibility` (public/private), `default_perm_level`, `deleted_at`/`deleted_by` (30-day soft delete, mirroring page trash) |
| `app_user` | Local mirror of OIDC identities (dense bigint ids required by ADR 0004) | `id` bigint PK, `oidc_subject` unique, `email`, `display_name`, `deactivated_at` |
| `space_member` | Space membership + per-member baseline level (drives the share dialog's member list) | `space_id`, `user_id`, `perm_level`, `added_at`; PK (space_id, user_id) |
| `page` | The primitive (ADR 0001). One row per page; blocks live in JSONB/Y.Doc | `id` uuid PK, `space_id`, `parent_id`, `title`, `slug`, `ydoc_s3_key`, `ydoc_state_vector` bytea (small), `document_json` jsonb, `rendered_html` text, `text_extract` text, `projection_updated_at`, `created_at`, `updated_at`, `deleted_at` (30-day trash) |
| `page_ancestor` | Closure table over **pages only** (never blocks) | `ancestor_id`, `descendant_id`, `depth`; PK (ancestor_id, descendant_id) |
| `page_permission` | Additive page-level grants above the space baseline (never reduce — Notion rule) | `page_id`, `user_id` (or `group_id`, V2), `perm_level`, `granted_by`, `granted_at` |
| `page_revision` | Revision pointers; blobs live in S3 (ADR 0006) | `id` uuid PK, `page_id`, `revision_s3_key`, `state_vector` bytea, `created_by`, `created_at`, `label`, `size_bytes` |
| `attachment` | Uploaded media; content-addressed objects | `id` bigint PK, `page_id`, `sha256`, `mime_type`, `size_bytes`, `s3_key`, `thumbnail_s3_key`, `uploaded_by`, `created_at`, `deleted_at` |
| `page_visit` | Per-user reading history behind the sidebar's Recent list. Written from the reader render through a throttled conditional upsert (`prisma/sql/recordPageVisit.sql`), so reloads and prefetches don't each cost a write | `user_id`, `page_id`, `visited_at`, `visits`; PK (user_id, page_id) |
| `page_star` | Per-user bookmarks behind the sidebar's Starred list | `user_id`, `page_id`, `starred_at`; PK (user_id, page_id) |
| `tag` | Freeform labels, **workspace-wide**: the name is the identity across every space. Normalised on write (`normalizeTag` in @angy/shared), so the unique index is the real deduplication; admins rename/merge what still drifts | `id` bigint PK, `name` unique, `created_by`, `created_at` |
| `page_tag` | Tag assignment. Written by anyone with EDIT on the page | `page_id`, `tag_id`, `added_by`, `added_at`; PK (page_id, tag_id), index on tag_id |
| `block_index` | Projection of the **actionable** nodes inside pages (ADR 0001, V2 H1) — page links, mentions and tasks; macros next. Worker-written alongside rendered_html, never by the editor; not a MATERIALIZED VIEW, and **not** the block table hard rule 2 forbids — it is derived, disposable and rebuildable from the Y.Doc. One row per actionable node, never one per block | `page_id`, `ord` (document order); PK (page_id, ord); `kind` (block_ref_kind: PAGE_LINK, MENTION, TASK), `target_page_id`, `target_user_id`, `payload` jsonb (links and mentions carry `{label}` — the text *as rendered*, which is what the stale-label refresh compares against; tasks add `{done}`, and put their first named user in `target_user_id` so "my tasks" is an indexed lookup); indexes on target_page_id (backlinks) and target_user_id (mention inbox) |

| `page_template` | Reusable page skeleton (V2 H2) — a snapshot of a page's `document_json`, stamped into new pages through the normal create path. Space-scoped, name unique per space so re-saving updates rather than duplicating. Deliberately not a Page with a flag: a template that is a page must be excluded from the tree, search, backlinks, trash and every listing, and missing one leaks it | `id` bigint PK, `space_id`, `name`, `description`, `document_json` jsonb, `created_by`, `created_at`; unique (space_id, name) |

Deferred to V2: group/team principals for permissions.

Open TODOs for the DDL pass: indexes (page.space_id, page_ancestor.descendant_id, page_revision.page_id+created_at, attachment.sha256), FK/on-delete behavior for trash vs hard-delete, and the revision retention policy (ADR 0006).
