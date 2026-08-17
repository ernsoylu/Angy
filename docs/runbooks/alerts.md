# Runbook: Alert Signals

Alerting is log-based: the stack emits `[alert]`-prefixed lines, and
`infra/alert-relay.sh` follows the compose logs and posts them to
`ALERT_WEBHOOK`. The signals below are evaluated on the reconciliation cadence
(every 5 minutes).

> Until V2 H5.0 this section described a "log pipeline" that paged on those
> lines. There was no pipeline. The lines were printed and nothing read them,
> which meant every signal here was only visible to someone already tailing the
> logs — the state an alert exists to rescue you from.

## Delivering them

```bash
cp infra/alert-relay.sh <deployment>/          # beside compose.prod.yml
ALERT_WEBHOOK=https://ntfy.sh/<topic> ./alert-relay.sh --test
```

Then run it for real under systemd, on the host rather than as a container —
reading other containers' logs needs the Docker socket, and mounting that into
a container hands it root:

```ini
# /etc/systemd/system/angy-alerts.service
[Unit]
Description=Angy alert relay
After=docker.service

[Service]
WorkingDirectory=/opt/angy
ExecStart=/opt/angy/alert-relay.sh
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

Repeats of the same line are collapsed for five minutes (`ALERT_COOLDOWN_SECONDS`):
a genuinely stuck projection re-fires every reconcile pass forever, and an
inbox full of one identical line is an inbox nobody reads.

## `[alert] projections stale across consecutive reconcile passes`

Stale projections were found on two consecutive sweeps — normally the first
sweep's rebuilds clear them, so persistence means rebuilds aren't completing.

1. Check worker logs for failed `rebuild` jobs (S3/Meilisearch/DB errors).
2. Check the `projections` BullMQ queue depth in Redis (`bull:projections:*`).
3. A wedged worker restart is safe: rebuilds are idempotent.

## `[alert] redis memory at N% of maxmemory`

The Y.Doc hot cache runs **noeviction** (hard rule): when Redis fills, writes
fail and the store path starts erroring — the data-loss window is the store
debounce (~2s).

1. Check for abnormally large hot docs: `redis-cli --bigkeys` (pattern `ydoc:hot:*`).
2. Hot keys carry a 30-minute TTL — a flood implies many concurrently edited
   pages or a leak; compaction shrinks oversized docs.
3. Raising `maxmemory` is the correct short-term fix. Never change the
   eviction policy.

## `[alert] compaction failed N× consecutively for <pageId>`

Same doc failing repeatedly — likely a corrupt update log (compaction
runbook). Escalate; never force-swap the blob pointer. The counter resets on
the first successful compaction and expires after 24h.

## Health endpoints

- api: `GET :3001/health`
- realtime: `GET :3002/health`
- web: any page (e.g. `/signin`)
- worker: no port — monitor its `[worker]`/`[alert]` log lines.
