#!/usr/bin/env bash
# Build production images. Run from anywhere; context is the repo root.
#
#   infra/docker/build.sh            # all four images
#   infra/docker/build.sh api web    # a subset
#
# Requires a reachable Postgres for prisma generate --sql (TypedSQL introspects
# against a live schema). Locally that's the compose stack via
# host.docker.internal; in CI point BUILD_DATABASE_URL at the service container.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="${BUILD_DATABASE_URL:-postgresql://user:password@host.docker.internal:5432/angy_dev}"
TAG="${TAG:-latest}"
APPS=("${@:-web api realtime worker}")

# Next inlines these into the client bundle, so the web image is environment-
# specific: set them per deployment target, not in angy-env (docs/env.md).
PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3001}"
PUBLIC_REALTIME_URL="${NEXT_PUBLIC_REALTIME_URL:-ws://localhost:3002}"

for app in ${APPS[@]}; do
  echo "==> building angy/${app}:${TAG}"
  docker build \
    -f "infra/docker/Dockerfile.${app}" \
    --build-arg DATABASE_URL="$DB" \
    --build-arg NEXT_PUBLIC_API_URL="$PUBLIC_API_URL" \
    --build-arg NEXT_PUBLIC_REALTIME_URL="$PUBLIC_REALTIME_URL" \
    --add-host "host.docker.internal:host-gateway" \
    -t "angy/${app}:${TAG}" \
    .
done
