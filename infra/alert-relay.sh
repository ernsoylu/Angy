#!/usr/bin/env bash
# Deliver the stack's `[alert]` lines to a human (V2 H5.0).
#
#   ./alert-relay.sh                 # follow the logs and post alerts
#   ./alert-relay.sh --test          # post one line and exit, to prove the hook
#
# docs/runbooks/alerts.md described a log pipeline that pages on `[alert]`
# lines. There was no pipeline: the worker printed the lines and nothing read
# them, so every signal the runbook documents — stale projections, Redis
# nearing its cap under a noeviction policy, a page failing compaction over and
# over — was only ever visible to someone already tailing the logs.
#
# Deliberately not a compose service: a container that reads other containers'
# logs needs the Docker socket, and mounting that is handing root to whatever
# runs inside. This runs on the host under systemd, where it already has the
# access it needs and nothing else does.
#
# Configuration (in the deployment's .env, or the systemd unit's environment):
#
#   ALERT_WEBHOOK   where to POST. An ntfy topic URL works as-is; so does a
#                   Slack/Discord webhook, which take a JSON body — see
#                   ALERT_FORMAT.
#   ALERT_FORMAT    "text" (default, ntfy) or "json" (Slack/Discord-style
#                   {"text": "…"}).
#   ALERT_SERVICES  space-separated compose services to watch.
set -euo pipefail
cd "$(dirname "$0")"

[ -f ./.env ] && { set -a; . ./.env; set +a; }

WEBHOOK="${ALERT_WEBHOOK:-}"
FORMAT="${ALERT_FORMAT:-text}"
SERVICES="${ALERT_SERVICES:-worker api realtime web}"
COMPOSE="docker compose -f compose.prod.yml"

if [ -z "$WEBHOOK" ]; then
  echo "[alert-relay] ALERT_WEBHOOK is not set — nothing to deliver to." >&2
  echo "[alert-relay] Set it in .env; see docs/runbooks/alerts.md." >&2
  exit 1
fi

post() {
  local line="$1"
  if [ "$FORMAT" = "json" ]; then
    # Escape the line for JSON by hand: jq is one more thing to install on a
    # box whose whole job is running containers.
    local escaped
    escaped=$(printf '%s' "$line" | sed 's/\\/\\\\/g; s/"/\\"/g')
    curl -fsS -m 10 -X POST -H 'content-type: application/json' \
      -d "{\"text\":\"$escaped\"}" "$WEBHOOK" >/dev/null || return 1
  else
    curl -fsS -m 10 -H 'Title: Angy alert' -H 'Priority: high' \
      -d "$line" "$WEBHOOK" >/dev/null || return 1
  fi
}

if [ "${1:-}" = "--test" ]; then
  post "[alert] test line from alert-relay on $(hostname) — delivery works"
  echo "[alert-relay] test alert posted"
  exit 0
fi

echo "[alert-relay] watching: $SERVICES"

# `--since 1m` rather than the whole history: a restart must not replay every
# alert the deployment has ever emitted, which is how an alerting path gets
# muted by the person receiving it.
#
# Repeats are collapsed for five minutes. The signals are evaluated on the
# reconciliation cadence, so a genuinely stuck projection re-fires every five
# minutes forever, and an inbox full of one identical line is an inbox nobody
# reads.
declare -A last_sent=()
COOLDOWN="${ALERT_COOLDOWN_SECONDS:-300}"

# shellcheck disable=SC2086 # SERVICES is a deliberate word-split list
$COMPOSE logs --follow --no-log-prefix --since 1m $SERVICES 2>/dev/null |
  grep --line-buffered -F '[alert]' |
  while IFS= read -r line; do
    key=$(printf '%s' "$line" | tr -cd '[:alnum:] ' | cut -c1-80)
    now=$(date +%s)
    previous="${last_sent[$key]:-0}"
    if [ $((now - previous)) -lt "$COOLDOWN" ]; then continue; fi
    last_sent[$key]=$now

    if post "$line"; then
      echo "[alert-relay] delivered: $line"
    else
      # Losing an alert silently is the failure this script exists to prevent,
      # so a delivery failure is itself printed where the next line will be.
      echo "[alert-relay] DELIVERY FAILED for: $line" >&2
    fi
  done
