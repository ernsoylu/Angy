# ADR 0009: Search Authorization via Meilisearch Tenant Tokens

**Status:** Accepted 2026-08-01

## Context

Search must never return pages the user cannot read. Per-user indexes explode operationally; filtering in the application after querying leaks counts/snippets and breaks pagination. Meilisearch's mechanism for this is **tenant tokens**: JWTs minted from an API key whose `searchRules` claim embeds a mandatory filter applied to every query. (Earlier drafts called this "secureRules" — that term does not exist.)

The permission model makes the filter tractable: page permissions only **grant** beyond the space baseline (Notion rule), so space-view ⇒ page-view for every page in that space. A user's effective read set is exactly: *pages in spaces they can view* ∪ *pages explicitly granted to them*.

## Decision

- One shared `pages` index over `text_extract`, with filterable attributes `space_id` and `page_id`.
- The API mints a per-session tenant token whose `searchRules` filter is `space_id IN [viewable space ids] OR page_id IN [explicitly granted page ids]`; TTL bounded to the session refresh interval so membership changes converge.
- Clients query Meilisearch directly with the tenant token. The master/admin key exists only in the API and worker (indexing); it is never shipped to a browser.
- Guardrail: if a user's explicit-grant list exceeds a sane bound (hundreds), fall back to proxying that user's searches through the API rather than minting a giant token.

## Consequences

- Enforcement is query-time and server-side (inside Meilisearch); no post-filtering, correct pagination and facet counts.
- Membership/grant changes are visible in search within one token TTL — same convergence class as ADR 0008 revocation; acceptable.
- The index carries no per-user data, so indexing stays one-pass in the worker.
- Anything indexed must carry `space_id` + `page_id` — the worker's indexing job owns that invariant.
