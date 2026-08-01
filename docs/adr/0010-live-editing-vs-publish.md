# ADR 0010: Live-by-Default Editing — No Draft/Publish State in V1

**Status:** Accepted 2026-08-01

## Context

Two industry models exist: Confluence-style **draft → explicit publish** (readers only ever see published versions) and Notion-style **live** editing (readers see the current document, always). The blueprint implicitly chose live — readers are served `rendered_html` regenerated ~2s (debounce) + projection-lag behind the editors' keystrokes — but never recorded it as a decision. For a "Confluence-class" product this needs to be deliberate: it means work-in-progress is visible to anyone with view rights.

## Decision

V1 is **live-by-default**: there is no draft state, no publish button, no forked "unpublished changes" document.

- Rationale: the CRDT model has exactly one document per page (hard rule 4); a draft/publish flow is effectively a branch, and branching a Y.Doc reintroduces the merge/round-trip problems this architecture deliberately avoids (cf. ADR 0005).
- Reader staleness is bounded by store-debounce + projection rebuild (~2–5s), which doubles as a tiny natural buffer.
- Mitigations for work-in-progress visibility: revision history + restore (ADR 0006), 30-day trash, and the pattern of drafting in a private space then **moving** the page when ready.
- If explicit publishing is ever demanded, the V2+ shape is "duplicate page → edit copy → replace original as a forward edit" — never a second live CRDT branch of the same page.

## Consequences

- Simplest possible mental model and implementation; collaboration-first, like Notion.
- Half-finished edits are visible to viewers — accepted, documented, and communicated in product UX (presence indicators show a page is being edited).
- The projection pipeline is the *only* read-side coupling to editing; no publish gate ever blocks the SSR path.
