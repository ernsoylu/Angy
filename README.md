# Angy — Wiki Knowledge Management System

> **Status: design blueprint.** Implementation has not started — this README describes the target system. Scope guardrails live in [CLAUDE.md](CLAUDE.md); feature sequencing in [docs/roadmap.md](docs/roadmap.md).

A **Confluence-class, blazing-fast, text-media-oriented wiki** for company knowledge management. Block-based editing (Notion-style) with real-time collaboration, page-level permissions, full version history, and a <100ms-TTFB SSR read budget.

## Why Angy?

Enterprise wikis today force a false choice: **rich collaboration OR fast, portable storage**. Confluence is powerful but slow and locked to Java/proprietary storage. MediaWiki is proven but rigid. Notion is fast but closed. **Angy unifies them**: the collaborative editing and permission model of Confluence, the block-first UX of Notion, the performance of a purpose-built fullstack (Yjs + Postgres + Redis + S3), and full data portability (Markdown export, one-way Git import/export).

Built for teams that need to **document, collaborate, and search at speed** — without sacrificing ownership of their data.

## Key Features

| Feature | Target | Note |
|---------|--------|------|
| Real-time collaborative editing | V1 | Yjs CRDT + Hocuspocus WebSockets |
| Page version history & restore | V1 | Full-state revision blobs, visual diff, non-destructive restore |
| Space + page permissions | V1 | Additive inheritance, Redis bitmap cache |
| Full-text search | V1 | Typo-tolerant Meilisearch, per-user tenant tokens |
| Block editor (paragraph, heading, list, code, image, table, etc.) | V1 | Tiptap 3 + ProseMirror |
| SSR-fast read path (<100ms TTFB budget) | V1 | Next.js RSC, zero editor JS for readers |
| Media attachments + CDN | V1 | S3/MinIO, Sharp thumbnails, signed URLs for private spaces |
| OIDC SSO | V1 | Keycloak/Authentik compatible |
| SCIM provisioning | V2 | Directory sync, after OIDC login ships |
| Confluence macros (Jira, TOC, etc.) | V2 | Planned |
| Confluence/Notion importer | V2 | Migration path for existing wikis |
| Page templates | V2 | Planned |
| Databases-in-pages | V2 | Notion-style structured data |
| Git import/export | V2 | One-directional flows (no round-trip) |
| Federated search (Slack, Drive, Jira) | V2 | Planned |

Nothing in this table is built yet — see the status banner above.

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Language** | TypeScript end-to-end | No polyglot stack; shared types, isomorphic block rendering |
| **Backend API** | Node.js + NestJS | REST in V1 (GraphQL deferred until a consumer needs it); BullMQ workers |
| **Frontend** | Next.js App Router + React | RSC streaming reads, client-only Tiptap editor |
| **Database** | PostgreSQL | JSONB projections, closure table, permissions |
| **Cache/Queue** | Redis | Sessions, Y.Doc hot cache, permission bitmaps, BullMQ |
| **Search** | Meilisearch | <50ms typo-tolerant queries, 1/10 the ops of Elasticsearch |
| **Object Storage** | S3 / MinIO | Y.Doc blobs, revision blobs, attachments, thumbnails |
| **CDN** | CloudFront / Cloudflare | Immutable sha256-keyed media URLs; signed for private spaces |
| **Collab CRDT** | Yjs + y-prosemirror + Hocuspocus | One Y.Doc per page, CRDT convergence, offline-tolerant editing |
| **Auth** | OIDC (Keycloak/Authentik) | SSO with Redis sessions; SCIM directory sync in V2 |

## Quick Start

### Prerequisites

- **Node.js 24 LTS**, **pnpm 10** (pinned via `packageManager`)
- **PostgreSQL 17**, **Redis 8.2 LTS** (or Valkey 8), **Meilisearch 1.x** — or use Docker
- **S3-compatible storage** (MinIO for local dev, AWS S3 for prod)
- Target library majors: Next.js 16 · React 19 · Tiptap 3 · Hocuspocus 4 · NestJS 11 · Yjs 13

### Bootstrap

```bash
git clone git@github.com:ernsoylu/Angy.git && cd Angy
pnpm install
pnpm docker:up                # postgres + redis + meilisearch + minio
cp .env.example .env.local    # then fill DATABASE_URL, REDIS_URL, MEILISEARCH_*, S3_*, OIDC_*
pnpm db:migrate && pnpm db:seed
pnpm dev                      # web :3000 · api :3001 · realtime :3002
```

Open http://localhost:3000 for the reader homepage; click "Edit" on a page to mount the editor. Full command reference: [CLAUDE.md § Commands](CLAUDE.md). Environment variables: [docs/env.md](docs/env.md).

## Project Structure

Four apps (`web`, `api`, `realtime`, `worker`) and three packages (`blocks`, `db`, `shared`) in a pnpm monorepo. The authoritative map lives in [CLAUDE.md § Monorepo Structure](CLAUDE.md).

## Architecture at a Glance

**Blocks are not database rows.** One page = one Postgres row + one Y.Doc blob in S3 + derived read projections. Readers get pre-rendered HTML streamed by Next.js RSC with zero editor JS; the Tiptap editor mounts client-side only on "Edit" and syncs over Hocuspocus, with debounced persistence to S3.

Full narrative, data-flow diagrams, and the consistency/backup model: [docs/architecture.md](docs/architecture.md). The non-negotiable data-model rules: [CLAUDE.md § Data Model Constraints](CLAUDE.md).

## Development

- **Environment variables**: [docs/env.md](docs/env.md) (canonical reference) + [.env.example](.env.example)
- **Tests**: `pnpm test` (unit + integration), `pnpm test:e2e` (Playwright, needs the Docker stack) — strategy in [CLAUDE.md § Testing](CLAUDE.md)
- **Migrations & local debugging recipes**: [docs/runbooks/dev-debugging.md](docs/runbooks/dev-debugging.md)

## Deployment

```bash
infra/docker/build.sh                  # builds angy/{web,api,realtime,worker}:latest
kubectl apply -f infra/k8s/angy.yaml   # V1 topology; secrets come from the angy-env Secret
```

Image builds need a reachable Postgres for `prisma generate --sql` (see the note in `infra/docker/build.sh`). Production environment variables: [docs/env.md](docs/env.md). Operational runbooks: [docs/runbooks/](docs/runbooks/). Note the V1 realtime topology: a single Hocuspocus replica with sticky sessions (see ADR 0008).

## Hard Rules

The seven data-model constraints — Y.Doc in S3 never Postgres, blocks never relational rows, one Y.Doc per page, bitmap permission cache, one-way Git flows only, no SSR editor mount, Yjs GC always on — live in [CLAUDE.md](CLAUDE.md), the single authoritative list. Violating them creates scaling bottlenecks, data corruption, or performance cliffs; rationale in [docs/adr/](docs/adr/).

## Contributing

1. Create a branch: `git checkout -b feat/your-feature`
2. Make changes and run: `pnpm lint`, `pnpm typecheck`, `pnpm test`
3. Commit with a descriptive message: `git commit -m "feat: add task block type"`
4. Push and open a pull request against `main`
5. One approval + CI passing = merge

**Code style:** ESLint + Prettier (enforced via pre-commit hook).
**Commits:** Follow [Conventional Commits](https://www.conventionalcommits.org/). Examples:
- `feat: implement live cursor presence in editor`
- `fix: permission bitmap invalidation on delete`
- `docs: add compaction worker runbook`

## Support & Documentation

- **Architecture & decisions:** [docs/architecture.md](docs/architecture.md), [docs/adr/](docs/adr/)
- **Database schema:** [docs/schema.md](docs/schema.md)
- **Runbooks:** [docs/runbooks/](docs/runbooks/)
- **Issues & questions:** [GitHub Issues](https://github.com/ernsoylu/Angy/issues)

## License

**Not finalized.** Candidates under evaluation: AGPL-3.0 with a separate commercial license for enterprises. Until a license is chosen, all rights reserved — see [LICENSE](LICENSE).

## Roadmap

**V1 — the core editing experience**: spaces & pages, block editor, real-time collab, SSR reads, permissions + search, attachments, OIDC login, revision history, trash/restore — REST API only. **V2** adds SCIM, GraphQL, Confluence/Notion import, macros, templates, databases-in-pages, Git flows, and federated search.

Full sequencing (deliberately date-free): [docs/roadmap.md](docs/roadmap.md).

## Credits

Angy synthesizes the best ideas from:

- **Confluence** — polymorphic content model, permissions, version history
- **Notion** — block-first UX, two-pointer system, workspace sharding
- **MediaWiki** — parser cache, revision separation, closure tables
- **Outline** — Postgres + Redis + S3 + Yjs stack
- **XWiki** — structured data classes, extension manager
- **BookStack** — portable HTML/Markdown export, clear hierarchy
- **Tiptap + ProseMirror** — best-in-class collaborative editing framework

---

**Made with ❤️ for teams that value speed, collaboration, and data ownership.**
