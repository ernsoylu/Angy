# Runbook: Homelab Deployment Behind a Pangolin Tunnel

Standing up Angy on a home server, published through a self-hosted Pangolin
instance. Topology and rationale: [ADR 0012](../adr/0012-homelab-tunnel-topology.md).

**Nothing in this file contains a secret.** Every credential is referenced by
variable name and lives in `$ANGY_HOME/.env` on the home server, `chmod 600`,
never committed.

`$ANGY_HOME` is wherever you put the deployment. `/opt/angy` is conventional
but needs root; a home directory works identically and needs nothing, since
membership of the `docker` group is the only privilege the stack requires.
Examples below use `~/angy`.

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

## 3. Write `~/angy/.env`

```bash
mkdir -p ~/angy/backup && chmod 700 ~/angy
```

Generate the secrets **on the server**, so they never exist anywhere else — not
in your shell history on another machine, not in a terminal scrollback:

```bash
cd ~/angy && umask 077
{ echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "MEILI_MASTER_KEY=$(openssl rand -hex 24)"
  echo "MINIO_ROOT_USER=angy$(openssl rand -hex 6)"
  echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)"
  echo "JWT_SECRET=$(openssl rand -hex 32)"
  echo "AUTHENTIK_SECRET_KEY=$(openssl rand -hex 32)"
  echo "AUTHENTIK_POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "OIDC_CLIENT_SECRET=$(openssl rand -hex 32)"; } > .env
chmod 600 .env
```

Then append the non-secret settings:

Every variable in `infra/compose.prod.yml` is required and has no inline
default, so a missing one fails at `up` rather than silently starting with a
dev password. Generate each secret fresh — `openssl rand -hex 32`:

```
OIDC_CLIENT_ID=angy-web
WEB_HOST=angy.<domain>
API_HOST=api.angy.<domain>
ID_HOST=id.<domain>
MEDIA_HOST=media.angy.<domain>
TAG=homelab
```

---

## 4. Bring it up

```bash
cd ~/angy
docker compose --env-file .env -f infra/compose.prod.yml up -d
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

**Read the close code, not the elapsed time.** Observed on the live
deployment: upgrade in 0.24s, idle for 60s, then `code=4408 reason="Connection
Timeout"` — Hocuspocus's own application-level close at its timeout, which is
the pass condition. A proxy reaping the connection gives `1006` (abnormal
closure, no close frame) at whatever its idle limit is. Same symptom in an
editor, opposite cause.

If it closes early with 1006, raise the idle timeout on the `rt.` resource in
Pangolin. Do **not** compensate by shortening the client timeout — that trades
a visible failure for constant reconnect churn that quietly degrades editing.

### 5.2 Sign-in

Sign in through the browser and confirm:

- The redirect chain ends back at `https://angy.<domain>`, not `localhost`
- The session cookie has **both** `HttpOnly` and `Secure` (DevTools →
  Application → Cookies). No `Secure` means `PUBLIC_API_URL` is not `https:`.

---

## 6. Backups

`infra/backup.sh`, deployed alongside the compose file. Run it from the
deployment directory:

```bash
./backup.sh            # dated snapshot under ./backup
./backup.sh --verify   # ...then restore it and assert the counts match
```

Scheduled by cron under the deploying user — no sudo, since docker-group
membership is the only privilege it needs:

```
20 3 * * 1-6  cd $HOME/angy && ./backup.sh          >> backup/backup.log 2>&1
20 3 * * 0    cd $HOME/angy && ./backup.sh --verify >> backup/backup.log 2>&1
```

Daily on weekdays, **drilled weekly**. The drill is the part that matters: the
usual way a backup fails is not corruption, it is a dump that was always empty
or a role that does not exist on restore — and you find out on the day you
cannot afford to.

### What it captures, and what it deliberately does not

| Volume | Contents | In the backup? |
|---|---|---|
| `miniodata` | Y.Doc blobs, revisions, media | ✅ **the actual content** |
| `pgdata` | pages, permissions, projections | ✅ |
| `authentikdb` | identities, provider config | ✅ |
| `meilidata` | search index | ❌ pure projection — reindexed from Postgres |
| `redisdata` | sessions, bitmaps, hot Y.Docs | ❌ see below |

**Postgres alone is not a backup.** It holds pointers into object storage, so
restoring the database without the bucket gives you a complete page tree in
which every page is empty. That is why the object store is archived first-class
rather than treated as a cache.

**Redis is the subtle omission.** Sessions and permission bitmaps are genuinely
disposable — they recompute. But Redis is *not* purely a cache for live Y.Docs:
the window between an edit and its debounced S3 store is real data that exists
nowhere else. That window is ~2s, which is why the store debounce stays short
and why `appendonly yes` and `noeviction` are both set. Losing it costs the
last couple of seconds of an in-flight edit, not a document.

### How it reads the object store

Directly from the volume, via a throwaway container, rather than through the
MinIO API — the image ships neither `tar` nor a writable staging area, and
anything staged under `/data` risks being read back as a bucket.

A file-level copy is safe because MinIO writes objects atomically (temp file,
then rename): a concurrent write is seen as either the old object or the new
one, never a torn one. Media keys are content-addressed and immutable anyway;
only the per-page Y.Doc blobs are ever overwritten.

### Restoring for real

```bash
# Postgres
docker compose -f compose.prod.yml exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_restore -U angy -d angy --clean --no-owner --no-privileges < backup/<stamp>/angy.dump

# Object store — stop MinIO first, or it will not see the files it is handed
docker compose -f compose.prod.yml stop minio
docker run --rm -v angy_miniodata:/data -v "$PWD/backup/<stamp>":/b:ro \
  alpine tar -xf /b/angy-docs.tar -C /data
docker compose -f compose.prod.yml start minio

# Meilisearch rebuilds itself; no restore step
```

Verified on this deployment 2026-08-07: dump restored into a throwaway
container, `space=1 page=1 user=1` matched the live manifest exactly.

### Off the machine

Snapshots are written locally and then replicated to a SMB share mounted at
`/mnt/Backups`, kept for 60 days there against 14 locally. Local first, then
copy — a dump streamed straight at the network is corrupted by a mid-write
blip, and the local copy is the fast path for an ordinary restore. The share is
the replica, not the target.

```
//<nas>/Backup /mnt/Backups cifs credentials=/etc/cifs/backup.cred,uid=1000,gid=1000,file_mode=0640,dir_mode=0750,_netdev,nofail 0 0
```

Credentials live in `/etc/cifs/backup.cred` (root, 0600), never in `/etc/fstab`
— fstab is world-readable. `nofail` keeps a NAS outage from blocking boot;
`uid=1000` lets the backup run unprivileged.

**A missing mount fails the run loudly rather than falling back to local-only.**
Quietly skipping is exactly how you discover months later that nothing was ever
copied — the failure this step exists to prevent. Watch for `[alert] OFFSITE`
in `backup/backup.log`.

**Still open:** these are snapshots, not point-in-time recovery, so losing the
server costs up to a day of edits. Continuous archiving (`wal_level=replica`
plus an archive command) is the upgrade when the content justifies it. The
share also sits on the same LAN, which covers disk failure but not the room.

## 7. Container hardening

The runtime stages run as the image's unprivileged `node` user (uid 1000), not
root, and the files are chowned on the way in — Next writes `.next/cache` at
runtime and cannot do so from a root-owned tree.

`pnpm` is pinned to the exact version in `package.json`'s `packageManager`
field. `pnpm@10` floats across minors, so two builds of the same commit could
resolve dependencies with different resolvers.

**Install scripts are disabled twice over.** `package.json` sets
`onlyBuiltDependencies` to six packages, and pnpm 10 blocks lifecycle scripts
for everything else by default. On top of that, every install in the
Dockerfiles and in CI passes `--ignore-scripts`, so nothing runs at all.

That second belt was added after testing, not before. The earlier claim here —
that `--ignore-scripts` would break the build by blocking Prisma's engines and
sharp's binaries — was **wrong**, and it was written without checking. Modern
sharp ships prebuilt platform binaries as optional dependencies rather than
compiling in a postinstall, Prisma's engines come bundled in the package, and
the Prisma client is generated by an explicit `prisma generate --sql` in
`prune.sh`. Verified: the worker image builds, loads sharp (vips 8.17.3),
resizes a real image to webp, initialises Prisma, indexes 9 pages and applies
the bucket policy — and 89 tests pass on an `--ignore-scripts` install.

One `# NOSONAR` remains in CI, on `playwright install`. That downloads a
browser rather than installing dependencies, and the flag would be passed
through to playwright, which does not accept it.

Two other scanner findings are accepted rather than fixed:

- `http://` inside `infra/k8s/rehearse.sh` and the CI probes is loopback and
  in-cluster traffic. Nothing crosses a network an attacker could sit on.
- `execSync("pnpm db:seed")` in the e2e setup resolves pnpm through `PATH`.
  Hardcoding a path would break portability to buy protection against an
  attacker who already controls the environment running the tests.

## Related

- [ADR 0012](../adr/0012-homelab-tunnel-topology.md) — topology and the five hostnames
- [ADR 0011](../adr/0011-authentik-single-idp.md) — why Authentik, and `issuer_mode`
- [ADR 0007](../adr/0007-media-access-control.md) — media URL forms; homelab amendment
- [docs/env.md](../env.md) — every variable, including the public/internal split
- [runbooks/key-rotation.md](key-rotation.md) — rotating any of the secrets above
- [runbooks/alerts.md](alerts.md) — the `[alert]` lines to watch once it is running
