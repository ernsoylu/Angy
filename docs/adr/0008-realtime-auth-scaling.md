# ADR 0008: Realtime Auth, Live Revocation, and V1 Topology

**Status:** Accepted 2026-08-01

## Context

The Hocuspocus WebSocket tier previously had no specified authentication or authorization story: how a connection proves who it is, how per-page edit rights are checked, what happens to a live session when rights are revoked, and how many realtime replicas V1 runs. User auth is OIDC with sessions in Redis; permissions are cached as page bitmaps (ADR 0004).

## Decision

- **Authn**: the API mints a short-lived signed token (HS256 with `JWT_SECRET`; TTL ≈ 60s, single-use intent) carrying `user_id` + `page_id` when the client clicks "Edit". The client passes it as the Hocuspocus connection token; `onAuthenticate` verifies the signature and expiry.
- **Authz**: after token verification, `onAuthenticate` checks the page's edit bit in the permission bitmap. No edit bit → connection rejected (readers never connect; they consume SSR HTML).
- **Live revocation**: permission changes already invalidate bitmaps (ADR 0004); the same code path publishes a `perm-changed(pageId)` event. The realtime server subscribes, re-checks every connection on that page, and disconnects (or downgrades to read-only awareness) any editor who lost rights. Worst-case exposure = event propagation latency, not session lifetime.
- **V1 topology**: a **single realtime replica** with sticky sessions — one Y.Doc must live in exactly one process. Horizontal fan-out (Hocuspocus Redis pub/sub extension) is deferred until concurrent-editor load demands it; the k8s manifest pins `replicas: 1` with a comment referencing this ADR.

## Consequences

- Stateless, replayable-safe connection auth without exposing session cookies to the WS handshake path.
- Revocation reaches live sessions in seconds; the bitmap alone was never enough (it only gates *new* checks).
- Single-replica ceiling in V1 — accepted and documented; capacity note lives in docs/architecture.md. Scaling out later changes deployment, not the data model.
- Long editing sessions outlive the connect token by design: the token gates *connection establishment*; revocation is handled by the event path, not token expiry.
