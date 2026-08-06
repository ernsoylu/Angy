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

## Amendment 2026-08-06 — homelab deployments have no CDN

The homelab target (behind a Pangolin tunnel, ADR 0012) has no CloudFront in
front of object storage. MinIO itself is published as a fifth public hostname,
`media.angy.<domain>`, and takes the CDN's place.

The decision above survives intact because it was written in terms of *URL
form*, not *which product serves it*:

- Public-space media keeps its bare immutable URL. The bucket's `media/`
  prefix carries an anonymous read policy, so those objects are readable by
  anyone holding the link — as they would be behind a public CDN.
- Private-space media keeps its signed short-TTL URL, now presigned SigV4
  against MinIO by `/media/[...key]` after the same permission check. MinIO
  enforces the signature exactly as CloudFront would.

Two consequences specific to this topology:

- **Every media byte crosses the tunnel twice** — up from the homelab to the
  VPS, back down to the viewer — and competes with the WebSocket tier for the
  same uplink. This is the accepted cost of not running a CDN; it is the first
  thing to revisit if reads feel slow.
- **`S3_ENDPOINT` alone is no longer sufficient.** Object storage now answers
  at two addresses, and a single variable cannot mean both: server-side SDK
  traffic must stay internal, while URLs handed to browsers must be public.
  Hence `S3_PUBLIC_ENDPOINT` (docs/env.md), used for bare URLs *and* for
  presigning — SigV4 covers the Host header, so a URL signed against
  `http://minio:9000` is rejected when presented to `media.angy.<domain>`.
