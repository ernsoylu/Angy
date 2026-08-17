# Runbook: Point-in-Time Recovery

The nightly `backup.sh` recovers the database to the moment it ran. That covers
a failed disk. It does not cover the case this runbook exists for: a bad
migration, a mistaken bulk delete, a script that ran against production at
4pm — where the damage is known to the minute and last night's dump throws away
everything since.

Two pieces make the difference:

- **`walreceiver`** (compose.prod.yml) streams the write-ahead log continuously
  into the `walarchive` volume, holding a replication slot so the server keeps
  segments until they have been received.
- **`./backup.sh --base`** takes a weekly physical base backup under
  `backup/base/<stamp>/`.

A base backup plus every WAL segment written since replays to any moment in
between.

## Check it is actually running

```bash
docker compose -f compose.prod.yml ps walreceiver          # up?
docker run --rm -v angy_walarchive:/wal alpine ls -1 /wal | tail -3
docker compose -f compose.prod.yml exec postgres \
  psql -U angy -d angy -c "select slot_name, active, restart_lsn from pg_replication_slots"
```

`active = f` on `angy_wal` means nothing is draining the slot. **Fix that
first** — see "the slot is the sharp edge" below.

## Recover to a point in time

Recovery is not in-place: it builds a second Postgres from the base backup and
replays into it, so the damaged database stays untouched until you have looked
at the result.

1. **Stop writing.** `docker compose -f compose.prod.yml stop api realtime worker web`
   — the database itself stays up, since the last WAL still has to reach the
   receiver.

2. **Pick a target.** The moment *just before* the damage, in UTC:
   `2026-08-17 15:58:00+00`.

3. **Unpack the newest base backup older than the target:**

   ```bash
   mkdir -p /tmp/pitr/data && cd /tmp/pitr
   tar xzf /path/to/deployment/backup/base/<stamp>/base.tar.gz -C data
   ```

4. **Stage the WAL** the replay will read:

   ```bash
   docker run --rm -v angy_walarchive:/wal -v /tmp/pitr:/out alpine \
     sh -c 'cp /wal/*.gz /out/wal/ 2>/dev/null; cp /wal/[0-9A-F]* /out/wal/ 2>/dev/null'
   gunzip -f /tmp/pitr/wal/*.gz 2>/dev/null || true
   ```

   Segments arriving from `pg_receivewal` are gzip-compressed; the `.partial`
   file is the one currently being streamed and is the newest data you have.
   Rename it without the suffix if the target is inside it.

5. **Tell the copy where to stop:**

   ```bash
   cat >> /tmp/pitr/data/postgresql.conf <<'EOF'
   restore_command = 'cp /wal/%f %p'
   recovery_target_time = '2026-08-17 15:58:00+00'
   recovery_target_action = 'promote'
   EOF
   touch /tmp/pitr/data/recovery.signal
   ```

6. **Replay, on a port that is not the live one:**

   ```bash
   docker run --rm -p 5433:5432 \
     -v /tmp/pitr/data:/var/lib/postgresql/data \
     -v /tmp/pitr/wal:/wal \
     -e POSTGRES_PASSWORD=drill postgres:17-alpine
   ```

   Watch for `recovery stopping before commit of transaction …` followed by
   `database system is ready to accept connections`.

7. **Look before you switch.** Connect to `localhost:5433` and confirm the data
   is what you expect at that moment — the row that should still exist, the
   table that should still have its column.

8. **Promote it.** Either dump the recovered database and restore it over the
   live one, or stop the live Postgres and swap the data directory. The first
   is reversible and slower; on a homelab, prefer it.

9. **Restart the apps, then take a fresh base backup immediately** —
   `./backup.sh --base`. The WAL chain after a recovery diverges from the one
   before it (a new timeline), and a base backup is the cleanest way to stop
   carrying that distinction around.

## The slot is the sharp edge

The replication slot is what makes the archive lossless: Postgres will not
recycle a WAL segment until the receiver has it. If the receiver is down and
nobody notices, the server keeps every segment and **fills its disk**, which
takes the whole deployment down.

- Watch it: `pg_replication_slots.active` and the size of `pg_wal`.
- If the receiver cannot be restarted quickly and the disk is filling:
  `select pg_drop_replication_slot('angy_wal')`. That trades point-in-time
  recovery for staying up, which is the right trade in that moment. Recreate it
  by restarting `walreceiver`, and take a base backup afterwards — the chain
  has a hole in it and only a new base closes it.

## What this does not cover

Object storage. Postgres holds pointers into MinIO, so a point-in-time database
without the matching objects is a page tree of empty pages. Media keys are
content-addressed and immutable, so they survive; the per-page Y.Doc blobs are
overwritten in place, which means a recovery to 4pm can land on a Y.Doc written
at 5pm. The projections rebuild from the Y.Doc, not the other way round — so
after a recovery, expect page *content* to be as of the object store, and page
*metadata* (tree, permissions, properties, comments) as of the recovery target.
Restore the object-store archive alongside if the two must agree.
