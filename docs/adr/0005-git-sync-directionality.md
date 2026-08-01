# ADR 0005: Git Flows Are One-Directional — Import or Export, Never Round-Trip

**Status:** Accepted (backfilled 2026-08-01; decision predates this document; feature itself is V2)

## Context

Data portability is a core promise, and "edit wiki pages as Markdown in Git, sync both ways" is a seductive feature. It is also unsound with a CRDT store: Markdown cannot represent Yjs metadata (tombstones, client clocks, causal order). Re-importing an exported file must create a *new* document state, which destroys concurrent-edit convergence and forks history for anyone editing the live page — a corruption class, not a bug.

## Decision

Two separate, one-directional flows (both V2):

- **Git import**: Markdown → a *fresh* Y.Doc / new page (or an explicit new version that replaces content as a normal forward edit). Never merged into existing CRDT state.
- **Git export**: Y.Doc snapshot → Markdown files. Exported files are never re-ingested onto the same document.

Two-way synchronization on the same document is permanently out of scope (CLAUDE.md hard rule 5).

## Consequences

- Portability holds: content can always leave (Markdown/HTML export) and enter (import as new pages).
- No "edit in Git, changes appear in the wiki" workflow — deliberate. Teams wanting Git-first docs should treat the wiki import as a publish step.
- Import/export tooling stays simple: no merge engine, no conflict UI, no tombstone reconciliation.
