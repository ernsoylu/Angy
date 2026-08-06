#!/usr/bin/env bash
# Prune a fully built workspace down to one app's production tree at /deploy.
# Called from the build stage of Dockerfile.{api,realtime,worker}; expects the
# workspace at /app, already installed and built, with DATABASE_URL reachable.
#
#   prune.sh api
set -euo pipefail
app="$1"

# `pnpm deploy` resolves prod-only dependencies from the store. Two quirks ride
# along, both handled below rather than worked around in the app code:
#
#  - node-linker=hoisted: Prisma's generator looks for @prisma/client directly
#    under the project root. pnpm's default isolated layout puts it a level
#    down inside .pnpm, and the generator then tries to `npm i` it instead.
#  - dist/ is copied by hand: the packer falls back to the root .gitignore when
#    a package has no .npmignore, and that excludes every build output — so the
#    deploy arrives with dependencies but no compiled code.
pnpm --config.node-linker=hoisted --filter "@angy/$app" --prod --legacy deploy /deploy
cp -r "/app/apps/$app/dist" /deploy/dist
for pkg in shared blocks db; do
  cp -r "/app/packages/$pkg/dist" "/deploy/node_modules/@angy/$pkg/dist"
done

# Second generate pass: the deploy re-materialised node_modules from the store,
# so the Prisma client generated during the build no longer exists. The CLI is
# a devDependency and stays behind in /app — only its output ships.
prisma_cli=$(echo /app/node_modules/.pnpm/prisma@*/node_modules/prisma/build/index.js)
cd /deploy
node "$prisma_cli" generate --sql --schema node_modules/@angy/db/prisma/schema.prisma
