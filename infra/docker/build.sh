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

for app in ${APPS[@]}; do
  echo "==> building angy/${app}:${TAG}"
  docker build \
    -f "infra/docker/Dockerfile.${app}" \
    --build-arg DATABASE_URL="$DB" \
    -t "angy/${app}:${TAG}" \
    .
done
