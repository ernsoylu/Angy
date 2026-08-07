#!/usr/bin/env sh
# Run a command with the repo's .env.local loaded.
#
#   ./with-env.sh prisma migrate dev
#
# The Prisma CLI reads `.env`, and this repo keeps its local configuration in
# `.env.local` (docs/env.md). Nothing bridged the two, so the documented
# first-time setup — `cp .env.example .env.local` then `pnpm db:migrate` —
# failed with "Environment variable not found: DATABASE_URL". CI never caught
# it because it sets DATABASE_URL as a job-level variable, so the only path
# exercised was the one that did not need the file.
#
# Node's `--env-file-if-exists` is the obvious fix and is already used by the
# seed script, but it only applies to node entry points; `.bin/prisma` is a
# shell wrapper, so the flag never reaches a JS module.
#
# An already-exported variable wins over the file. That keeps CI authoritative
# where it sets DATABASE_URL explicitly, and lets anyone point one command at a
# different database without editing their .env.local.
set -eu

ENV_FILE="${ENV_FILE:-../../.env.local}"

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key=${line%%=*}
    # Skip anything the environment already defines, rather than sourcing the
    # whole file and letting it overwrite a deliberate override.
    eval "already=\${$key+set}"
    [ -n "${already:-}" ] && continue
    export "$line"
  done < "$ENV_FILE"
fi

exec "$@"
