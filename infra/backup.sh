#!/usr/bin/env bash
# Back up an Angy deployment: both Postgres databases and the object store.
#
#   ./backup.sh                  # write a dated snapshot under ./backup
#   ./backup.sh --verify         # ...then restore it into a throwaway
#                                #    container and assert the row counts match
#
# Run it from the deployment directory (the one holding compose.prod.yml and
# .env). Intended for cron or a systemd timer; prints nothing sensitive.
#
# What is actually irreplaceable, in order:
#
#   miniodata   Y.Doc blobs, revision blobs, media. THE CONTENT. Postgres holds
#               only pointers to it — restoring the database without the bucket
#               gives you a page tree where every page is empty.
#   pgdata      pages, permissions, projections
#   authentikdb identities and provider config; rebuildable by hand, tediously
#   meilidata   omitted deliberately — a pure projection, reindexed from Postgres
#   redisdata   omitted; sessions and permission bitmaps are disposable, and the
#               live Y.Doc window is ~2s (see the runbook's note on this)
set -euo pipefail
cd "$(dirname "$0")"

VERIFY=0
[ "${1:-}" = "--verify" ] && VERIFY=1

COMPOSE="docker compose -f compose.prod.yml"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="backup/$STAMP"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
# Off-machine replica. A snapshot on the same disk as the data survives a bad
# migration but not a failed disk, and the disk is the likelier loss.
OFFSITE="${BACKUP_OFFSITE:-/mnt/Backups/angy}"
OFFSITE_RETAIN_DAYS="${BACKUP_OFFSITE_RETAIN_DAYS:-60}"

set -a; . ./.env; set +a
mkdir -p "$OUT"

log() { printf '[backup] %s\n' "$1"; }

# ── Postgres ────────────────────────────────────────────────────────────────
# Custom format (-Fc), not plain SQL: it restores selectively, in parallel, and
# refuses to load into an incompatible schema rather than half-applying.
log "dumping angy database"
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U angy -d angy -Fc > "$OUT/angy.dump"

log "dumping authentik database"
$COMPOSE exec -T -e PGPASSWORD="$AUTHENTIK_POSTGRES_PASSWORD" authentik-postgres \
  pg_dump -U authentik -d authentik -Fc > "$OUT/authentik.dump"

# ── Object store ────────────────────────────────────────────────────────────
# Read the volume directly from a throwaway container rather than going through
# the MinIO API. The image ships neither tar nor a writable staging area, and
# anything staged under /data risks being read back as a bucket.
#
# A file-level copy is safe here because MinIO writes objects atomically
# (temp file then rename), so a concurrent write is seen as either the old
# object or the new one, never a torn one. Content-addressed media keys are
# immutable anyway; only the per-page Y.Doc blobs are ever overwritten.
log "archiving object storage"
VOL=$(docker volume ls --format '{{.Name}}' | grep -m1 -E '^angy_miniodata$')
[ -n "$VOL" ] || { log "FAILED: cannot find the minio volume"; exit 1; }
docker run --rm -v "$VOL":/data:ro alpine \
  tar -cf - -C /data angy-docs > "$OUT/angy-docs.tar"

for f in angy.dump authentik.dump angy-docs.tar; do
  [ -s "$OUT/$f" ] || { log "FAILED: $f is empty"; exit 1; }
done
du -sh "$OUT" | awk '{print "[backup] wrote " $1 " to '"$OUT"'"}'

# Record what was live, so a restore can be checked against it rather than
# against a guess. A backup you cannot verify is a hypothesis.
$COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U angy -d angy -tAc \
  "select 'space='||(select count(*) from space)||' page='||(select count(*) from page)||' user='||(select count(*) from app_user)" \
  > "$OUT/manifest.txt"
log "manifest: $(cat "$OUT/manifest.txt")"

# ── Off-machine copy ────────────────────────────────────────────────────────
# Written locally first, then replicated: a dump streamed straight to the NAS
# is corrupted by a mid-write network blip, and the local copy is also the fast
# path for an ordinary restore. The NAS is the replica, not the target.
#
# A missing mount is reported loudly and fails the run. Skipping quietly is how
# you discover months later that nothing was ever copied — the failure mode
# this whole step exists to prevent.
if mountpoint -q "$(dirname "$OFFSITE")" 2>/dev/null || [ -d "$OFFSITE" ]; then
  if mkdir -p "$OFFSITE" 2>/dev/null && cp -r "$OUT" "$OFFSITE/" 2>/dev/null; then
    log "replicated to $OFFSITE/$STAMP"
    find "$OFFSITE" -maxdepth 1 -type d -name '20*' -mtime +"$OFFSITE_RETAIN_DAYS" \
      -exec rm -rf {} + 2>/dev/null || true
  else
    log "[alert] OFFSITE COPY FAILED — $OFFSITE is present but not writable"
    exit 1
  fi
else
  log "[alert] OFFSITE MOUNT MISSING — $(dirname "$OFFSITE") is not mounted; only a local copy exists"
  exit 1
fi

# ── Retention ───────────────────────────────────────────────────────────────
find backup -maxdepth 1 -type d -name '20*' -mtime +"$RETAIN_DAYS" -exec rm -rf {} + 2>/dev/null || true

# ── Restore drill ───────────────────────────────────────────────────────────
# The whole point. An untested backup is a hypothesis, and the way it usually
# fails is not corruption — it is a dump that was always empty, or a role that
# does not exist on restore, discovered on the day it matters.
if [ "$VERIFY" = 1 ]; then
  log "restore drill: loading the dump into a throwaway database"
  NET=$(docker network ls --format '{{.Name}}' | grep -m1 -E '^angy_default$')
  CID=$(docker run -d --rm --network "$NET" \
        -e POSTGRES_USER=angy -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=angy \
        postgres:17-alpine)
  trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

  for _ in $(seq 1 30); do
    docker exec "$CID" pg_isready -U angy -d angy >/dev/null 2>&1 && break
    sleep 2
  done

  docker exec -i -e PGPASSWORD=drill "$CID" \
    pg_restore -U angy -d angy --no-owner --no-privileges < "$OUT/angy.dump" >/dev/null 2>&1 || true

  GOT=$(docker exec -e PGPASSWORD=drill "$CID" psql -U angy -d angy -tAc \
    "select 'space='||(select count(*) from space)||' page='||(select count(*) from page)||' user='||(select count(*) from app_user)")
  WANT=$(cat "$OUT/manifest.txt")

  if [ "$(echo "$GOT" | tr -d ' ')" = "$(echo "$WANT" | tr -d ' ')" ]; then
    log "RESTORE VERIFIED — $GOT"
  else
    log "RESTORE MISMATCH"
    log "  live:     $WANT"
    log "  restored: $GOT"
    exit 1
  fi
fi

log "done"
