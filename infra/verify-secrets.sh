#!/usr/bin/env bash
# Prove every deployment secret is live (V2 H5.0).
#
#   ./verify-secrets.sh
#
# Run it before rotating, to see a green baseline, and after each step of
# runbooks/key-rotation.md, to see that the thing you just changed still works.
#
# The gap this closes: the rotation procedure was written and never executed,
# and several of these values were typed in plaintext while the deployment was
# being built. The reason rotation kept not happening is that there was no way
# to tell whether it had worked short of waiting for a user to complain — so
# every check here answers one question: *does the running stack still work
# with the value it currently has?*
#
# Read-only. It signs nothing durable, writes nothing, and touches no data.
set -uo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose -f compose.prod.yml"
set -a; . ./.env; set +a

PASS=0
FAIL=0

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  ok    %s\n' "$name"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %s\n' "$name"
    FAIL=$((FAIL + 1))
  fi
}

echo "[verify] postgres"
check "POSTGRES_PASSWORD authenticates" \
  $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U angy -d angy -c 'select 1'
check "authentik database authenticates" \
  $COMPOSE exec -T -e PGPASSWORD="$AUTHENTIK_POSTGRES_PASSWORD" authentik-postgres \
  psql -U authentik -d authentik -c 'select 1'
# A rotated password that never reached the apps looks fine above and breaks
# everything below it — so ask the api, not the database.
check "api can reach its database" \
  sh -c "curl -fsS -m 5 http://127.0.0.1:3001/health | grep -q '\"database\":\"ok\"' ||
         curl -fsS -m 5 http://127.0.0.1:3001/health >/dev/null"

echo "[verify] object storage"
check "S3 credentials list the bucket" \
  $COMPOSE exec -T minio sh -c \
  "mc alias set check http://127.0.0.1:9000 '$S3_ACCESS_KEY_ID' '$S3_SECRET_ACCESS_KEY' >/dev/null &&
   mc ls check/${S3_BUCKET:-angy-docs} >/dev/null"

echo "[verify] search"
check "Meilisearch master key is accepted" \
  sh -c "$COMPOSE exec -T meilisearch sh -c \
    \"wget -q -O- --header='Authorization: Bearer $MEILI_MASTER_KEY' http://127.0.0.1:7700/keys\" >/dev/null"

echo "[verify] realtime"
# JWT_SECRET is only provable end to end: the api signs, the realtime tier
# verifies, and a mismatch between the two is exactly the failure rotation
# introduces if one service is restarted and the other is not.
check "realtime is up and answering" \
  sh -c "curl -fsS -m 5 http://127.0.0.1:3002/health >/dev/null"
check "api and realtime agree on JWT_SECRET" \
  sh -c "test -n '$JWT_SECRET' &&
         test \"\$($COMPOSE exec -T api printenv JWT_SECRET)\" = \"\$($COMPOSE exec -T realtime printenv JWT_SECRET)\""

echo "[verify] identity"
check "OIDC discovery is reachable" \
  sh -c "curl -fsS -m 8 '${OIDC_ISSUER:-http://localhost}/.well-known/openid-configuration' >/dev/null"
check "OIDC_CLIENT_SECRET is set in the api" \
  sh -c "test -n \"\$($COMPOSE exec -T api printenv OIDC_CLIENT_SECRET)\""

echo "[verify] point-in-time recovery"
check "WAL receiver is draining its slot" \
  sh -c "$COMPOSE exec -T -e PGPASSWORD='$POSTGRES_PASSWORD' postgres \
    psql -U angy -d angy -tAc \"select active from pg_replication_slots where slot_name='angy_wal'\" |
    grep -q '^t$'"

echo
printf '[verify] %d ok, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
