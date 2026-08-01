# Runbook: Local Development & Debugging

Recipes moved out of the README so it stays a quickstart. Prereq: `pnpm docker:up` stack running, `.env.local` filled from [.env.example](../../.env.example) (see [env.md](../env.md)).

## Database migrations

After editing `packages/db/prisma/schema.prisma`:

```bash
pnpm db:generate        # regenerate Prisma client
pnpm db:migrate         # create a new migration
# review packages/db/prisma/migrations/<timestamp>_<slug>/migration.sql
pnpm db:migrate deploy  # apply to the dev database
```

One migration per PR, forward-only; never edit a merged migration (CLAUDE.md).

## Postgres

```bash
psql "$DATABASE_URL"
SELECT id, title, projection_updated_at, updated_at FROM page LIMIT 5;
-- stale projections = updated_at newer than projection_updated_at
```

## Redis

```bash
redis-cli
> SCAN 0 MATCH perm:page:* COUNT 100     # permission bitmaps (prefer SCAN over KEYS)
> BITCOUNT perm:page:<id>:view           # how many users cached as viewers
> INFO memory                            # watch the Y.Doc hot cache
```

## Meilisearch

```bash
curl "http://localhost:7700/indexes/pages/search?q=test" \
  -H "Authorization: Bearer $MEILISEARCH_API_KEY"   # admin key = dev only; clients use tenant tokens
```

## Hocuspocus / realtime

Set `DEBUG=hocuspocus:*` in `.env.local`, then watch `apps/realtime` logs. Connection rejects with 4401/4403-class reasons are auth/perm failures from `onAuthenticate` (ADR 0008).

## Tests

```bash
pnpm test               # unit + integration (vitest)
pnpm test -- --watch    # TDD watch mode
pnpm test -- --coverage # coverage report
pnpm test:e2e           # Playwright; needs docker stack + pnpm dev
```
