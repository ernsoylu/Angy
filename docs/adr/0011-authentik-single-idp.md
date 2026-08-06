# ADR 0011: Authentik Is the Identity Provider, and There Is Exactly One

**Status:** Accepted (2026-08-06)

## Context

The stack description said "OIDC (Keycloak/Authentik)" without choosing, and the sign-in screen (frame 6) rendered two buttons — "Continue with Keycloak" and "Continue with Authentik" — that pointed at the same `/auth/login` URL. `OidcService` resolves a single `OIDC_ISSUER_URL`, so clicking either signed you into whichever issuer was configured. The screen offered a choice the system could not honour.

Two questions were tangled together: *which* IdP, and *how many*.

Angy is also the first of a planned suite — a Jira-class project tool and a self-hosted Git forge (Forgejo) are intended to sit alongside it, all behind one sign-on.

## Decision

**Authentik**, and exactly one IdP.

Authentik over Keycloak because of provisioning direction. Angy's V2 roadmap includes SCIM, and the two products sit on opposite sides of it: Authentik ships an *outbound* SCIM provider that pushes users and groups into other applications, which is precisely what Angy (and later the PM tool) needs to receive. Keycloak's SCIM support is the inbound half — other systems provisioning *into* Keycloak — and is still a preview feature behind a flag. Authentik is also materially lighter to run, which matters for a homelab deployment.

Single IdP because multi-IdP solves a problem Angy does not have. Two identity providers are for federating separate directories — customers each bringing their own. One company with one directory needs one. The second button is removed rather than wired up.

The accepted cost: Authentik is open-core, so a feature Angy depends on could in principle move behind the enterprise tier. Nothing currently used is enterprise-gated, and the exposure is bounded — see below.

## Consequences

- `OIDC_ISSUER_URL` becomes an Authentik *application* issuer, `<host>/application/o/<app-slug>/`, not a Keycloak realm URL.
- The provider must use `issuer_mode: per_provider`. With `global`, Authentik advertises `http://host/` as the issuer while serving discovery from `/application/o/<slug>/`; `openid-client` validates that the two agree and discovery fails outright.
- Local dev config moves from `infra/keycloak/angy-realm.json` to `infra/authentik/blueprints/angy.yaml`. Blueprints are declarative and reapplied on worker start, so the dev IdP stays reproducible.
- Authentik runs a server *and* a worker, plus its own Postgres. Redis is shared with Angy on a separate DB index.
- **Switching back is cheap and stays cheap.** Angy talks plain OIDC through `openid-client` and never uses a provider-specific API. A different IdP is three environment variables and a new realm/blueprint. Nothing in `apps/api` knows which product is on the other end, and that property is worth preserving deliberately.
- Group claims are not consumed yet. `space_member` is still written only by the seed and the Wave E endpoints. Mapping an Authentik `groups` claim onto space membership is the next integration step, and it is the contract the rest of the suite will share.
