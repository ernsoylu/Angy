# ADR 0003: Unified TypeScript Stack — No Go, No PHP, No Java

**Status:** Accepted (backfilled 2026-08-01; decision predates this document)

## Context

The obvious temptation is a polyglot stack: Go for the WebSocket/realtime tier, TypeScript for the frontend. But this system's core invariant is **isomorphic block rendering**: the same Tiptap/ProseMirror extensions must render a block in the client editor *and* in the server-side static renderer that produces `rendered_html`. A second language means reimplementing every block's rendering and serialization twice, forever — the exact class of drift bug this architecture is designed to prevent.

## Decision

TypeScript end-to-end: NestJS (REST API), Hocuspocus on Node (realtime), BullMQ workers, Next.js frontend. Shared zod schemas and DTOs in `packages/shared`; shared block extensions in `packages/blocks`, consumed by both the editor and the worker's static renderer.

## Consequences

- One implementation of every block, one validation layer, one type system across the wire; one hiring/review profile.
- Realtime fan-out is I/O-bound — Node handles it fine; this is not a computational workload.
- CPU-heavy work (image thumbnails via sharp's native code, Y.Doc compaction with its ~75× memory spikes) is isolated in worker processes so it can never stall the API or realtime event loops.
- Accepted ceiling: if a truly CPU-bound subsystem ever emerges, it becomes an isolated service *behind a queue* — not a rewrite of shared rendering logic.
