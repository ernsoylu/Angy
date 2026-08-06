# ADR 0012: Homelab Deployment Behind a Pangolin Tunnel

**Status:** Accepted (2026-08-06)

## Context

Angy's first real deployment is not a cloud region. It is a home server on a
residential connection, published to the internet through an existing
self-hosted [Pangolin](https://docs.fossorial.io/) instance on a VPS
(`snc.ad`). Pangolin is a tunnelled reverse proxy: Traefik terminates TLS on
the VPS, Gerbil runs a WireGuard endpoint, and a `newt` client on the home
server dials *outbound* to it. Nothing listens for inbound connections on the
home network.

This inverts several assumptions the codebase had absorbed from local
development, where every service is reachable at `localhost:<port>` and that
address is simultaneously the internal address, the public address, and the
address the browser uses. Behind a tunnel those three come apart.

A prior audit found five places where they had been conflated. Two were
outright blockers — the OIDC `redirect_uri` and the callback URL were built
from `http://localhost:${env.port}`, so sign-in would have redirected users to
a host that does not exist. The others were the missing `Secure` cookie flag,
the build-time `NEXT_PUBLIC_*` values, and object storage having no notion of a
public address at all.

## Decision

**Deploy behind the tunnel with five public hostnames, and make every
public-facing origin explicitly configurable.**

| Hostname | Target | Serves |
|---|---|---|
| `angy.snc.ad` | `web:3000` | Next.js reader + editor |
| `api.angy.snc.ad` | `api:3001` | NestJS REST |
| `rt.angy.snc.ad` | `realtime:3002` | Hocuspocus WebSocket |
| `id.snc.ad` | `authentik-server:9000` | Authentik (ADR 0011) |
| `media.angy.snc.ad` | `minio:9000` | Object storage (ADR 0007 amendment) |

Three principles follow:

1. **Internal and public addresses are separate variables.** `S3_ENDPOINT`
   stays internal; `S3_PUBLIC_ENDPOINT` is what browsers get. `PUBLIC_API_URL`
   is the API's origin as the browser sees it, distinct from its listen port.
   Both default to the old single-address behaviour, so local dev is unchanged.
2. **Only these five are exposed.** Postgres, Redis, Meilisearch and
   Authentik's Postgres have no public hostname and are not tunnel targets.
   `infra/compose.prod.yml` publishes *no* container port to the host either —
   `newt` shares the docker network and reaches targets by service name, so the
   tunnel is the only ingress, not merely the intended one.
3. **Pangolin's own authentication is disabled on all five.** Angy has its own
   session layer and Authentik is the IdP; putting a second auth gate in front
   would break the OIDC redirect dance and every API client.

## Consequences

- **`SameSite=Lax` still works, and that is not an accident.** `snc.ad` is the
  registrable domain, so all five hostnames are same-site siblings.
  Credentialed XHR from `angy.snc.ad` to `api.angy.snc.ad` is a same-site
  request, and the top-level redirect back from `id.snc.ad` carries the session
  cookie. Moving any component to a different registrable domain would force
  `SameSite=None`, which in turn hard-requires `Secure` and re-opens CSRF
  questions this design does not currently have to answer.
- **The session cookie's `Secure` flag is derived, not hardcoded** — from
  whether `PUBLIC_API_URL` is `https:`. Hardcoding it either way breaks one of
  the two environments: plain-http local dev silently drops a `Secure` cookie.
- **The web image is environment-specific.** `NEXT_PUBLIC_API_URL` and
  `NEXT_PUBLIC_REALTIME_URL` are inlined into the client bundle at build time,
  so the image must be built against the final public hostnames. An image built
  for localhost cannot be promoted to the homelab by changing its environment.
- **The WebSocket tier is the risk.** Hocuspocus's server-side `timeout` is 60s
  and the provider's `messageReconnectTimeout` is 30s; an idle-upgrade or
  buffering proxy anywhere in the path breaks collaborative editing in a way
  that plain HTTP would not reveal. This is why proving the WS path is its own
  gate (G1) rather than an assumption.
- **All traffic is bounded by residential upstream bandwidth**, and media
  crosses the tunnel twice (home → VPS → viewer). See the ADR 0007 amendment.
- **The VPS becomes a single point of failure** for external access. Local
  access does not depend on it, which is worth preserving: nothing in the stack
  should require reaching `snc.ad` to function on the LAN.

## Alternatives rejected

- **Port-forwarding from the router.** Requires a static IP or dynamic DNS,
  exposes the home network directly, and puts certificate renewal on the home
  server. The tunnel already exists and costs nothing extra.
- **Streaming media through the web app** instead of exposing MinIO. Would have
  kept the public surface to four hostnames and avoided any anonymous read
  policy, at the cost of every image byte occupying a Node process. Rejected in
  favour of the fifth hostname; see the ADR 0007 amendment for what that gives
  up.
- **Cloudflare Tunnel.** Equivalent in shape, but would add a second
  vendor alongside the Pangolin instance already in service.
