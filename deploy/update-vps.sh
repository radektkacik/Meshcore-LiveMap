#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -z "${DEPLOY_HOST:-}" && -f "$ROOT_DIR/.deploy.env" ]]; then
  set -a
  . "$ROOT_DIR/.deploy.env"
  set +a
fi
SSH_KEY=${SSH_KEY:-"$ROOT_DIR/cntb"}
DEPLOY_HOST=${DEPLOY_HOST:?Set DEPLOY_HOST, e.g. root@your-server}
PUBLIC_URL=${PUBLIC_URL:-"https://mapa.meshcore.cz/"}
VITE_BASE_PATH=${VITE_BASE_PATH:-/}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
REMOTE_STAGE="/tmp/meshcore-live-map-$RELEASE_ID"
BUILD_DIR=$(mktemp -d)
ROLLBACK_SCRIPT=${ROLLBACK_SCRIPT:-/root/rollback-meshcore.sh}

cleanup() {
  rm -rf "$BUILD_DIR"
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" "rm -rf '$REMOTE_STAGE'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"
VITE_BASE_PATH="$VITE_BASE_PATH" VITE_BETA=0 npm run build -- --outDir "$BUILD_DIR/dist" --emptyOutDir
node --check server.mjs

ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" "mkdir -p '$REMOTE_STAGE'"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  server.mjs http-server.mjs admin-auth.mjs monitor.mjs mqtt-ingest.mjs backend-utils.mjs node-metrics.mjs packet-store.mjs cz-health.mjs cz-health-store.mjs visit-stats.mjs feedback.mjs photos.mjs node-info.mjs comments.mjs repeater-pages.mjs notify.mjs html.mjs sqlite-store.mjs admin-pages.mjs legacy-pages.mjs http-utils.mjs package.json package-lock.json \
  "$DEPLOY_HOST:$REMOTE_STAGE/"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$BUILD_DIR/dist/" "$DEPLOY_HOST:$REMOTE_STAGE/dist/"

LOCAL_LOCK=$(sha256sum package-lock.json | cut -d ' ' -f 1)
REMOTE_LOCK=$(ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "sha256sum /opt/meshcore-live-map/package-lock.json 2>/dev/null" \
  | cut -d ' ' -f 1 || true)
if [[ "$LOCAL_LOCK" == "$REMOTE_LOCK" ]]; then
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
    "cp -a /opt/meshcore-live-map/node_modules '$REMOTE_STAGE/node_modules'"
else
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
    "cd '$REMOTE_STAGE' && npm ci --omit=dev"
fi
scp -q -i "$SSH_KEY" -o BatchMode=yes \
  "$ROOT_DIR/deploy/apply-release.sh" \
  "$ROOT_DIR/deploy/rollback-vps.sh" \
  "$ROOT_DIR/deploy/meshcore-live-map-storage.conf" \
  "$DEPLOY_HOST:$REMOTE_STAGE/"

ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "ROLLBACK_SCRIPT='$ROLLBACK_SCRIPT' bash '$REMOTE_STAGE/apply-release.sh' '$REMOTE_STAGE' '$RELEASE_ID'"

curl --fail --silent --show-error --max-time 20 "$PUBLIC_URL" >/dev/null || true
ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "curl --fail --silent --show-error --max-time 20 'http://127.0.0.1:4173/' >/dev/null"
printf 'Deployment %s completed: %s\n' "$RELEASE_ID" "$PUBLIC_URL"
