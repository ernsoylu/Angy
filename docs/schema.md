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

Deferred to V2: `block_index` (projection of actionable blocks — tasks, mentions, macros, embeds — worker-UPSERTed; not a Postgres MATERIALIZED VIEW), group/team principals for permissions.

Open TODOs for the DDL pass: indexes (page.space_id, page_ancestor.descendant_id, page_revision.page_id+created_at, attachment.sha256), FK/on-delete behavior for trash vs hard-delete, and the revision retention policy (ADR 0006).
