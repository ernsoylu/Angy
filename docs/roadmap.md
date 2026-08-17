# Roadmap

> Deliberately date-free: sequencing is committed, timing is not. **V1 is shipped and deployed**; V2 is the live section. The enforceable scope guardrails for agents ("do not build in V1") live in [CLAUDE.md](../CLAUDE.md); this file is the product-facing view and must stay consistent with it.

## V1 — Ship the Core Editing Experience ✅ *shipped*

- Spaces + pages + page closure table
- Tiptap block editor: paragraph, heading, list, code, image, table, callout, divider, blockquote
- Yjs + Hocuspocus real-time collab; Y.Doc in S3; compaction worker
- SSR read path via @tiptap/static-renderer; edit-on-click mount
- Page-level permissions + space baseline + Redis bitmap cache
- Meilisearch full-text search (tenant-token authz)
- S3 attachments + Sharp thumbnails + CDN (signed URLs for private spaces)
- OIDC SSO (Authentik, ADR 0011) — login only
- Page revision history (full-state blobs — ADR 0006) with visual diff and non-destructive restore
- Page move/trash/restore (30-day soft delete)
- REST API only
- E2E test suite (Playwright) incl. the CRDT convergence test

## V2

Shipped:

- ✅ block_index projection + worker + UI: tasks board, mentions, backlinks
- ✅ Page templates
- ✅ Markdown import / export (one-directional — ADR 0005)
- ✅ **Confluence/Notion importer** — the migration path for teams adopting Angy
- ✅ Per-user mention notifications + in-app inbox
- ✅ Manual page ordering (fractional index — the prerequisite databases needed)
- ✅ **Threaded comments** — pulled forward from V3 (ADR 0014)
- ✅ Notion-style databases-in-pages, first slice: page properties + a
  read-only table view over a page's children (ADR 0013)

Waiting on a reason — each is real, none has a consumer yet:

- SCIM provisioning (directory sync)
- GraphQL API (when a consumer needs it)
- Confluence-style macros (Jira, TOC, decision, meeting notes)
- Federated search connectors (Slack, Drive, Jira)
- PDF / Word export via headless Puppeteer queue
- Databases beyond the first slice: board, calendar and gallery views,
  relations, rollups

## V3+

- Comments beyond the first cut: inline reply notifications per thread, and
  search over comment bodies (`text_extract` is built from the document, so a
  discussion is not findable by its words)
- Mobile apps (React Native or PWA)
- Activity feed & audit log UI
- Extension manager / custom block marketplace (runtime block-type registry)
- Per-line authorship / blame view
- AI-assisted search & summarization
