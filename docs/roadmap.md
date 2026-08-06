# Roadmap

> Deliberately date-free: sequencing is committed, timing is not. **Nothing is built yet** — the repo is a design blueprint. The enforceable scope guardrails for agents ("do not build in V1") live in [CLAUDE.md](../CLAUDE.md); this file is the product-facing view and must stay consistent with it.

## V1 — Ship the Core Editing Experience

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

- SCIM provisioning (directory sync)
- GraphQL API (when a consumer needs it)
- block_index projection + worker + UI: tasks board, mentions, backlinks
- Confluence-style macros (Jira, TOC, decision, meeting notes)
- **Confluence/Notion importer** — the migration path for teams adopting Angy
- Page templates
- Notion-style databases-in-pages (class/property model)
- Git import / Git export (one-directional — ADR 0005)
- Federated search connectors (Slack, Drive, Jira)
- Per-user mention notifications + in-app inbox
- PDF / Word export via headless Puppeteer queue

## V3+

- Real-time commenting with threaded replies *(strong V2 candidate — pull forward if enterprise adoption demands it)*
- Mobile apps (React Native or PWA)
- Activity feed & audit log UI
- Extension manager / custom block marketplace (runtime block-type registry)
- Per-line authorship / blame view
- AI-assisted search & summarization
