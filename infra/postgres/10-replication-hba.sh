#!/usr/bin/env bash
# Let pg_receivewal (the walreceiver service) authenticate — V2 H5.0, PITR.
#
# The stock image ships replication rules for localhost only:
#
#   local  replication  all                   trust
#   host   replication  all  127.0.0.1/32     trust
#   host   replication  all  ::1/128          trust
#
# and its catch-all `host all all all scram-sha-256` does NOT cover them,
# because `all` in the database column deliberately does not match the
# `replication` keyword. So a receiver on the compose network is refused with
# "no pg_hba.conf entry for replication connection", the slot is never created,
# and PITR silently does nothing until the day it is needed.
#
# Runs from /docker-entrypoint-initdb.d, so it applies to a **fresh** cluster
# only. pg_hba.conf lives inside the pgdata volume and an existing deployment
# keeps the one it was initialised with — upgrading an install that predates
# this file needs the same line appended by hand, which is
# runbooks/homelab.md § 8.
#
# `all` as the address is the compose network and nothing else: postgres
# publishes no port (ADR 0012), so it is only reachable from inside the
# project. It matches the style of the catch-all rule directly above it.
set -euo pipefail

cat >> "$PGDATA/pg_hba.conf" <<'HBA'

# H5.0 PITR: pg_receivewal streams from the compose network; the rules above
# cover replication from localhost only.
host replication all all scram-sha-256
HBA
