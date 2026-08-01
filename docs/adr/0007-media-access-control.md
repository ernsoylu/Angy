# ADR 0007: Media Access Control — Signed URLs for Private Spaces

**Status:** Accepted 2026-08-01

## Context

Attachments are served from a CDN under immutable sha256-keyed URLs — great for caching, but a content-addressed URL is merely *unguessable*, not *authorized*. Anyone holding the link (forwarded email, browser history, logs) can fetch the bytes forever. For an enterprise wiki with permissioned spaces, security-by-obscurity on media is not acceptable; this decision was previously unmade.

## Decision

Attachment access inherits the containing page's permission, enforced at the CDN edge:

- **Private-space media**: served only via short-TTL signed access — CloudFront signed cookies (preferred: one grant covers all media on a page view) or signed URLs minted by the API using the deployment's token-signing secret (`JWT_SECRET`).
- **Public-space media**: served via bare immutable sha256 URLs — maximum cacheability, no signing overhead.
- The renderer decides at HTML-generation/serve time which URL form to emit based on the space's visibility.
- Objects remain content-addressed in S3 regardless; signing wraps access, it does not change storage keys.

## Consequences

- Real authorization at the edge; revocation happens within the signature TTL (minutes, not never).
- Private media loses some CDN cache efficiency (per-viewer query strings with signed URLs; signed cookies mitigate this) — accepted cost of correctness.
- Key management: CDN signing keypair (or JWT_SECRET-based token endpoint) becomes part of the deployment secrets; rotation procedure belongs in a runbook before GA.
- Moving a page between spaces of different visibility must invalidate/re-emit its media URL forms — worker responsibility.
