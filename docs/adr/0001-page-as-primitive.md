# ADR 0001: Page as Primitive — Blocks Are JSONB, Not Rows

**Status:** Accepted (backfilled 2026-08-01; decision predates this document)

## Context

Block-based editors invite a schema where every block is a relational row, with a `block_ancestor` closure table and per-block permissions. The initial blueprint critique showed where that leads at company scale: a closure table over blocks explodes into billions of rows (pages × blocks × depth), a per-block permission cache explodes into billions of Redis keys, and the relational block tree permanently fights the CRDT document model (two sources of truth for the same structure).

## Decision

The **page** is the only content-bearing relational entity.

- Blocks live inside `page.document_json` (a JSONB projection of the ProseMirror document) and inside the page's Y.Doc (authoritative while editing).
- Hierarchy (`page_ancestor` closure table) exists over pages only — never blocks.
- Permissions attach to spaces and pages only. The page is the smallest permission unit.
- Block-level queries (tasks, mentions, macros, embeds) are served by a derived `block_index` projection table of *actionable blocks only*, rebuilt asynchronously by the worker — deferred to V2 with its consumers.

## Consequences

- Bounded row counts: rows scale with pages, not blocks. Reads fetch one row.
- Relational and CRDT models align: one page ↔ one document ↔ one Y.Doc.
- No SQL joins over block structure; anything block-shaped queries the projection (V2) or the JSONB.
- Per-block permissions are impossible by design — accepted; the page is the ACL unit (matches Confluence/Notion behavior).
