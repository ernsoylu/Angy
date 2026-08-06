# Runbook: Alert Signals

V1 alerting is log-based: the worker emits `[alert]`-prefixed lines and the log
pipeline pages on them. Two signals exist today, both evaluated on the
reconciliation cadence (every 5 minutes).

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
