# Runbook: Y.Doc Compaction Worker

> Stub — flesh out with real job names/metrics once `apps/worker` exists.

## What it does

Merges a page's accumulated Yjs updates into a fresh `Y.encodeStateAsUpdate` blob in S3, updates `ydoc_state_vector`, and writes a revision checkpoint (`page_revision` + revision blob — ADR 0006).

## Cadence

- Nightly full pass over recently-edited pages.
- Size-triggered: enqueue immediately when a page's stored blob or pending update volume crosses the threshold.

## Hard operational rules

- **Memory**: `encodeStateAsUpdate` can transiently consume ~75× the doc size. Compaction runs **only** in the worker, with bounded concurrency (1–2 docs at a time) and memory headroom. Never in the API or realtime request path.
- **Safety**: idempotent. Write the new blob under a new S3 key → verify → swap the pointer (`ydoc_s3_key`) → keep the previous blob until the next successful cycle. Never delete before the swap is confirmed.
- **Yjs GC stays on** (hard rule 7); compaction is what bounds growth for any doc that ever runs gc-off.

## Failure handling

- Retry with backoff; the page keeps serving from the last-good blob throughout.
- Alert when the same doc fails N consecutive runs (likely a corrupt update log — escalate, do not force-swap).
