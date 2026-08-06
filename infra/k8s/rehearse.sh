#!/usr/bin/env bash
# Clean-deploy rehearsal: stand up angy.yaml on a throwaway kind cluster and
# prove all four workloads reach Ready with a real `angy-env` Secret.
#
#   infra/docker/build.sh          # images first (A2)
#   pnpm docker:up                 # backing services on the host
#   infra/k8s/rehearse.sh          # create, deploy, smoke-test
#   infra/k8s/rehearse.sh --down   # delete the cluster
#
# Postgres/Redis/Meilisearch/MinIO stay on the host: this rehearses the app
# topology, not the data tier, which in production is managed infrastructure.
# The pods reach them over the kind docker network's gateway.
set -euo pipefail
cd "$(dirname "$0")/../.."

CLUSTER="${CLUSTER:-angy-rehearsal}"
KIND="${KIND:-kind}"
KUBECTL="${KUBECTL:-kubectl}"
TAG="${TAG:-latest}"

if [[ "${1:-}" == "--down" ]]; then
  "$KIND" delete cluster --name "$CLUSTER"
  exit 0
fi

echo "==> creating kind cluster ${CLUSTER}"
"$KIND" get clusters 2>/dev/null | grep -qx "$CLUSTER" || "$KIND" create cluster --name "$CLUSTER"
KUBECONFIG_CTX="kind-${CLUSTER}"

echo "==> loading images"
for app in web api realtime worker; do
  "$KIND" load docker-image "angy/${app}:${TAG}" --name "$CLUSTER"
done

# The host gateway as seen from inside the cluster's docker network. Take the
# IPv4 entry explicitly: kind's network is dual-stack and lists ULA first, but
# the compose services bind v4 and a bare v6 literal is invalid in a URL anyway.
HOST_IP=$(docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' \
  | grep -m1 -E '^[0-9]+\.')
echo "==> backing services reachable at ${HOST_IP}"

echo "==> creating the angy-env Secret"
"$KUBECTL" --context "$KUBECONFIG_CTX" create namespace angy --dry-run=client -o yaml \
  | "$KUBECTL" --context "$KUBECONFIG_CTX" apply -f -
"$KUBECTL" --context "$KUBECONFIG_CTX" -n angy create secret generic angy-env \
  --from-literal=DATABASE_URL="postgresql://user:password@${HOST_IP}:5432/angy_dev" \
  --from-literal=REDIS_URL="redis://${HOST_IP}:${REDIS_PORT:-6379}" \
  --from-literal=MEILISEARCH_URL="http://${HOST_IP}:7700" \
  --from-literal=MEILISEARCH_API_KEY="masterKey" \
  --from-literal=S3_ENDPOINT="http://${HOST_IP}:9000" \
  --from-literal=S3_ACCESS_KEY_ID="minioadmin" \
  --from-literal=S3_SECRET_ACCESS_KEY="minioadmin" \
  --from-literal=S3_BUCKET="angy-docs" \
  --from-literal=S3_REGION="us-east-1" \
  --from-literal=OIDC_ISSUER_URL="http://${HOST_IP}:8080/realms/angy" \
  --from-literal=OIDC_CLIENT_ID="angy-web" \
  --from-literal=OIDC_CLIENT_SECRET="changeme" \
  --from-literal=JWT_SECRET="rehearsal-secret-at-least-32-characters-long" \
  --from-literal=NEXT_PUBLIC_API_URL="http://api.angy.example.com" \
  --from-literal=NEXT_PUBLIC_REALTIME_URL="ws://rt.angy.example.com" \
  --from-literal=API_INTERNAL_URL="http://api.angy.svc.cluster.local" \
  --dry-run=client -o yaml \
  | "$KUBECTL" --context "$KUBECONFIG_CTX" apply -f -

echo "==> kubectl apply"
"$KUBECTL" --context "$KUBECONFIG_CTX" apply -f infra/k8s/angy.yaml

echo "==> waiting for rollouts"
for app in api realtime worker web; do
  "$KUBECTL" --context "$KUBECONFIG_CTX" -n angy rollout status "deploy/${app}" --timeout=180s
done

echo "==> smoke test"
"$KUBECTL" --context "$KUBECONFIG_CTX" -n angy run smoke --rm -i --restart=Never \
  --image=curlimages/curl:latest --command -- \
  sh -c 'curl -sf http://api/health && echo && curl -sf http://realtime/health && echo && curl -sfo /dev/null -w "web %{http_code}\n" http://web/signin'

# With a seeded database, prove the whole read path — web pod → api Service →
# Postgres — not just that the processes answer. SMOKE_SESSION is a session key
# planted in Redis by e2e/global-setup.ts (e.g. e2e-eren).
if [[ -n "${SMOKE_SESSION:-}" ]]; then
  echo "==> reader smoke test as ${SMOKE_SESSION}"
  "$KUBECTL" --context "$KUBECONFIG_CTX" -n angy run reader --rm -i --restart=Never \
    --image=curlimages/curl:latest --command -- \
    sh -c "curl -sf -H 'cookie: angy_session=${SMOKE_SESSION}' http://web/s/eng | grep -qo 'Recently updated' && echo 'space home rendered server-side'"
fi

"$KUBECTL" --context "$KUBECONFIG_CTX" -n angy get pods
echo "==> rehearsal complete — tear down with: $0 --down"
