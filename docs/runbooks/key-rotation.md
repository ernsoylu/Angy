# Runbook: Secret & Key Rotation

Rotation procedures for every signing/access secret in the deployment
(ADR 0007 required this before GA). All secrets live in the `angy-env`
Secret (k8s) or `.env.local` (dev); see docs/env.md for the inventory.

## JWT_SECRET (realtime connect + media tokens)

Signs 15-minute page-scoped tokens only — never long-lived credentials — so
rotation is cheap:

1. Deploy the new value to **api and realtime together** (they must agree).
2. In-flight tokens signed with the old secret fail verification; clients
   transparently fetch a fresh token on reconnect (the provider uses a token
   function). Worst case: editors reconnect once.
3. No stored data references the secret. Done.

## Meilisearch keys

- **Master key** (`MEILISEARCH_API_KEY`): set the new key on the server,
  update api + worker env, restart both. The api re-discovers the default
  search key at first use after restart.
- **Default search key** (used to sign tenant tokens): rotating the master
  key regenerates it. Outstanding tenant tokens (≤15 min) die with the old
  key — searches fall back with an error until the page refetches a token.

## S3 credentials (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`)

1. Create the new credential pair alongside the old one.
2. Roll api, realtime, worker, and web (the media route presigns) to the new
   pair.
3. Presigned URLs issued under the old credentials keep working until their
   5-minute expiry; revoke the old pair after that window.

## OIDC client secret (`OIDC_CLIENT_SECRET`)

Rotate in the IdP (Authentik) first with dual-secret support if
available, update the api env, restart. Active Redis sessions are unaffected
— the secret is used only during the code exchange.

## CDN signing keypair (production CloudFront/Cloudflare)

When the CDN tier exists: private-space media must use signed cookies/URLs
at the edge (ADR 0007). Rotate by adding the new public key to the trusted
key group, switching signing to the new private key, then removing the old
public key after the signature TTL. Until that tier is provisioned, the
S3-presigning path above is authoritative.
