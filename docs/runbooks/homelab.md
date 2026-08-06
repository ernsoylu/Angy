# Runbook: Homelab Deployment Behind a Pangolin Tunnel

Standing up Angy on a home server, published through a self-hosted Pangolin
instance. Topology and rationale: [ADR 0012](../adr/0012-homelab-tunnel-topology.md).

**Nothing in this file contains a secret.** Every credential is referenced by
variable name and lives in `/opt/angy/.env` on the home server, `chmod 600`,
never committed.

---

## 0. What you need before starting

| Thing | Where it comes from |
|---|---|
| A Pangolin instance with a reachable dashboard | Already running on the VPS |
| DNS for the five hostnames pointing at the VPS | Your DNS provider; a wildcard `*.angy.<domain>` covers three of them |
| A home server running Docker | — |
| The `newt` connector installed there as a systemd unit | Pangolin's site setup script |
| Built images for all four apps | `infra/docker/build.sh` — see §2 |

The five hostnames (ADR 0012). Substitute your own domain throughout:

| Hostname | Newt target | Container |
|---|---|---|
| `angy.<domain>` | `127.0.0.1:3000` | `web` |
| `api.angy.<domain>` | `127.0.0.1:3001` | `api` |
| `rt.angy.<domain>` | `127.0.0.1:3002` | `realtime` |
| `id.<domain>` | `127.0.0.1:9010` | `authentik-server` (container port 9000) |
| `media.angy.<domain>` | `127.0.0.1:9000` | `minio` |

Those five ports bind to `127.0.0.1`, not `0.0.0.0` — reachable by the
connector and by nothing else on the LAN. Postgres, Redis and Meilisearch
publish nothing at all.

---

## 1. Create the Pangolin site and resources

In the Pangolin dashboard:

1. **Create a site** of type *Newt*. Pangolin shows a `NEWT_ID` and
   `NEWT_SECRET` **once**. Install the connector on the home server as a
   systemd unit (`/etc/systemd/system/newt.service`) — *not* as a container in
   `infra/compose.prod.yml`. Two connectors for one network means Pangolin has
   two competing sites.
2. **Create five resources**, one per hostname above. For each:
   - Type: **HTTP**
   - Target: **`127.0.0.1` and the host port** from the table below. The
     connector is a host process, so it dials from the host network namespace
     and cannot resolve docker service names; the compose file publishes each
     tunnel target on the loopback for exactly this reason.
   - **Authentication: disabled.** Angy has its own session layer and Authentik
     is the IdP. A second gate in front breaks the OIDC redirect and every API
     client (ADR 0012).
3. **On `rt.angy.<domain>` only**: confirm WebSocket upgrades are allowed and
   note the idle timeout. This is the one that bites — see §5.

> **Doing this over the API instead?** Pangolin's Integration API listens on
> **port 3003**, not 443, and is gated behind `flags.enable_integration_api:
> true` in the server config. It is not exposed by default and was not
> reachable from outside during setup. Either configure through the dashboard,
> or publish 3003 deliberately (behind its own Pangolin resource with auth
> *enabled*) if you want automation later.

---

## 2. Build the images

The web image is **environment-specific**: Next inlines `NEXT_PUBLIC_*` into
the client bundle at build time, so an image built for localhost cannot be
promoted here by changing its environment (ADR 0012).

```bash
NEXT_PUBLIC_API_URL=https://api.angy.<domain> \
NEXT_PUBLIC_REALTIME_URL=wss://rt.angy.<domain> \
TAG=homelab \
infra/docker/build.sh
```

Note `wss://`, not `ws://`. Traefik terminates TLS, and a page served over
https cannot open an insecure WebSocket — the browser blocks it as mixed
content, with a console error that does not mention your proxy at all.

Then move the images to the home server (registry push, or `docker save | ssh …
docker load`).

---

## 3. Write `/opt/angy/.env`

```bash
sudo install -d -m 755 /opt/angy
sudo touch /opt/angy/.env && sudo chmod 600 /opt/angy/.env
```

Every variable in `infra/compose.prod.yml` is required and has no inline
default, so a missing one fails at `up` rather than silently starting with a
dev password. Generate each secret fresh — `openssl rand -hex 32`:

```
POSTGRES_PASSWORD=
MEILI_MASTER_KEY=
MINIO_ROOT_USER=
MINIO_ROOT_PASSWORD=
JWT_SECRET=
AUTHENTIK_SECRET_KEY=
AUTHENTIK_POSTGRES_PASSWORD=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
WEB_HOST=angy.<domain>
API_HOST=api.angy.<domain>
ID_HOST=id.<domain>
MEDIA_HOST=media.angy.<domain>
TAG=homelab
```

---

## 4. Bring it up

```bash
cd /opt/angy
docker compose --env-file /opt/angy/.env -f infra/compose.prod.yml up -d
docker compose -f infra/compose.prod.yml exec api node -e "…"   # see §4.1
```

### 4.1 Migrate

Migrations do not run automatically — that is deliberate, so a restart can
never surprise you with a schema change.

They cannot run *inside* the app containers either: the pruned runtime images
carry the schema and the migration SQL but not the Prisma CLI, which is a
devDependency and correctly absent from production. Lift the schema out and
run the CLI in a throwaway container on the same network:

```bash
cd ~/angy
cid=$(docker create angy/api:homelab)
rm -rf prisma && mkdir -p prisma
docker cp "$cid:/app/node_modules/@angy/db/prisma/." prisma/
docker rm "$cid"

set -a; . ./.env; set +a
docker run --rm --network angy_default \
  -v "$PWD/prisma:/prisma" \
  -e DATABASE_URL="postgresql://angy:${POSTGRES_PASSWORD}@postgres:5432/angy" \
  node:24-alpine \
  npx -y prisma@6.19.3 migrate deploy --schema /prisma/schema.prisma
```

Until this runs, `worker` crash-loops on `The table public.page does not exist`
(P2021) — that is the expected symptom of a migrated-too-late database, not a
worker bug.

There is no production seed. `pnpm db:seed` creates fake users and demo
content; a real deployment starts empty and gets its first space from the UI.

### 4.2 Configure Authentik

The dev blueprint (`infra/authentik/blueprints/angy.yaml`) is **not** mounted
in production — it carries the well-known client secret and a shared password.
Configure the provider through the admin UI at `https://id.<domain>`:

- Provider type **OAuth2/OpenID**, client type **confidential**
- `client_id` / `client_secret` must match `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`
- **`issuer_mode: per_provider`** — with `global`, Authentik advertises
  `https://id.<domain>/` as the issuer while serving discovery from
  `/application/o/angy/`, and `openid-client` fails discovery on the mismatch
  (ADR 0011)
- `sub_mode: hashed_user_id` — the subject must be stable per user, since
  `app_user.oidc_subject` is the join key
- Redirect URI, strict: `https://api.angy.<domain>/auth/callback`
- Scopes: exactly `openid profile email`

Verify discovery agrees with itself before trying to sign in:

```bash
curl -s https://id.<domain>/application/o/angy/.well-known/openid-configuration \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['issuer'])"
```

The printed issuer must equal the URL you just fetched from, minus the
`.well-known/...` suffix. If it prints a bare `https://id.<domain>/`, the
provider is still on `issuer_mode: global`.

### 4.3 Make the public media prefix readable

Public-space media is served as bare immutable URLs (ADR 0007), which requires
an anonymous read policy on the `media/` prefix — and *only* that prefix:

```bash
docker compose -f infra/compose.prod.yml exec minio \
  mc anonymous set download local/angy-docs/media
```

`media-private/` must stay private; it is reached only through
`/media/[...key]`, which checks page permission and then presigns.

---

## 5. Verify — in this order

Each step assumes the previous one passed. Stop at the first failure; the later
symptoms are usually just the earlier cause wearing a disguise.

```bash
# 1. Tunnel is up — the connector is a host unit, not a container
systemctl status newt --no-pager
journalctl -u newt -n 20 --no-pager   # want: "Tunnel connection ... established"

# 2. Each hostname reaches the right service
curl -sf https://api.angy.<domain>/health
curl -sf https://rt.angy.<domain>/health
curl -sfI https://angy.<domain>/signin | head -1

# 3. Media: public prefix anonymous, private prefix refused
curl -sfI https://media.angy.<domain>/angy-docs/media/<known-key> | head -1   # 200
curl -sI  https://media.angy.<domain>/angy-docs/media-private/x | head -1     # 403
```

> **If `api`, `realtime` or `web` sit at `unhealthy` while their logs look
> fine**, check the probe before the service. The runtime images ship node and
> essentially nothing else — no curl, no wget — so a shell-based probe reports
> a live service as unhealthy and `depends_on: service_healthy` stalls
> everything behind it. `docker inspect <c> --format '{{range
> .State.Health.Log}}{{.Output}}{{end}}'` shows the real error.

### 5.1 The WebSocket check (the one that actually matters)

Hocuspocus's server `timeout` is 60s and the provider's
`messageReconnectTimeout` is 30s. A proxy that closes idle upgrades faster than
that turns collaborative editing into a reconnect loop — and it will look like
a CRDT bug, not a proxy setting.

Hold a connection open past 60s with no traffic:

```bash
npx wscat -c "wss://rt.angy.<domain>/" &
sleep 75 && echo "still connected?"
```

If it drops early, raise the idle timeout on the `rt.` resource in Pangolin.
Do **not** compensate by shortening the client timeout — that trades a visible
failure for a constant reconnect churn that quietly degrades editing.

### 5.2 Sign-in

Sign in through the browser and confirm:

- The redirect chain ends back at `https://angy.<domain>`, not `localhost`
- The session cookie has **both** `HttpOnly` and `Secure` (DevTools →
  Application → Cookies). No `Secure` means `PUBLIC_API_URL` is not `https:`.

---

## 6. Backups

Volumes to back up, in order of how much it hurts to lose them:

| Volume | Contents | Recoverable without a backup? |
|---|---|---|
| `miniodata` | Y.Doc blobs, revisions, media | **No — this is the actual content** |
| `pgdata` | Pages, permissions, projections | No |
| `authentikdb` | Identities, provider config | Rebuildable by hand, tediously |
| `meilidata` | Search index | Yes — reindex from Postgres |
| `redisdata` | Sessions, hot Y.Docs, bitmaps | Mostly — see below |

Redis is the subtle one. It is a cache for permission bitmaps (recomputed
lazily) but *not* purely a cache for live Y.Docs: the window between an edit and
its debounced S3 store is real data that exists nowhere else. That window is
~2s, which is why `appendonly yes` and `noeviction` are both set, and why the
store debounce should stay short.

Both Postgres containers mount `./backup`, so:

```bash
docker compose -f infra/compose.prod.yml exec postgres \
  pg_dump -U angy angy -Fc -f /backup/angy-$(date +%F).dump
```

Restore drill belongs on the calendar, not in the incident. An untested backup
is a hypothesis.

---

## Related

- [ADR 0012](../adr/0012-homelab-tunnel-topology.md) — topology and the five hostnames
- [ADR 0011](../adr/0011-authentik-single-idp.md) — why Authentik, and `issuer_mode`
- [ADR 0007](../adr/0007-media-access-control.md) — media URL forms; homelab amendment
- [docs/env.md](../env.md) — every variable, including the public/internal split
- [runbooks/key-rotation.md](key-rotation.md) — rotating any of the secrets above
- [runbooks/alerts.md](alerts.md) — the `[alert]` lines to watch once it is running
