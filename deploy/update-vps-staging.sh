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
PUBLIC_URL=${PUBLIC_URL:-"https://2b.meshcore.cz/betamap/"}
VITE_BASE_PATH=${VITE_BASE_PATH:-/betamap/}
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
REMOTE_STAGE="/tmp/meshcore-live-map-stage-$RELEASE_ID"
BUILD_DIR=$(mktemp -d)

export APP_DIR=/opt/meshcore-live-map-stage
export SERVICE=meshcore-live-map-stage.service
export OVERRIDE_DIR=/etc/systemd/system/meshcore-live-map-stage.service.d
export STORAGE_CONF_NAME=meshcore-live-map-stage-storage.conf
export HEALTH_PORT=4174

cleanup() {
  rm -rf "$BUILD_DIR"
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" "rm -rf '$REMOTE_STAGE'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT_DIR"
VITE_BASE_PATH="$VITE_BASE_PATH" VITE_BETA=1 npm run build -- --outDir "$BUILD_DIR/dist" --emptyOutDir
node --check server.mjs

ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" "mkdir -p '$REMOTE_STAGE'"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  server.mjs backend-utils.mjs node-metrics.mjs packet-store.mjs visit-stats.mjs feedback.mjs photos.mjs node-info.mjs comments.mjs notify.mjs package.json package-lock.json \
  "$DEPLOY_HOST:$REMOTE_STAGE/"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes" \
  "$BUILD_DIR/dist/" "$DEPLOY_HOST:$REMOTE_STAGE/dist/"

LOCAL_LOCK=$(sha256sum package-lock.json | cut -d ' ' -f 1)
REMOTE_LOCK=$(ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "sha256sum $APP_DIR/package-lock.json 2>/dev/null" \
  | cut -d ' ' -f 1 || true)
if [[ "$LOCAL_LOCK" == "$REMOTE_LOCK" ]]; then
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
    "cp -a $APP_DIR/node_modules '$REMOTE_STAGE/node_modules'"
else
  ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
    "cd '$REMOTE_STAGE' && npm ci --omit=dev"
fi
scp -q -i "$SSH_KEY" -o BatchMode=yes \
  "$ROOT_DIR/deploy/apply-release.sh" \
  "$ROOT_DIR/deploy/rollback-vps.sh" \
  "$ROOT_DIR/deploy/meshcore-live-map-stage-storage.conf" \
  "$DEPLOY_HOST:$REMOTE_STAGE/"

ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "APP_DIR='$APP_DIR' SERVICE='$SERVICE' OVERRIDE_DIR='$OVERRIDE_DIR' STORAGE_CONF_NAME='$STORAGE_CONF_NAME' HEALTH_PORT='$HEALTH_PORT' bash '$REMOTE_STAGE/apply-release.sh' '$REMOTE_STAGE' '$RELEASE_ID'"

curl --fail --silent --show-error --max-time 20 "$PUBLIC_URL" >/dev/null || true
ssh -i "$SSH_KEY" -o BatchMode=yes "$DEPLOY_HOST" \
  "curl --fail --silent --show-error --max-time 20 'http://127.0.0.1:4174/' >/dev/null"
printf 'Staging/beta deployment %s completed: %s\n' "$RELEASE_ID" "$PUBLIC_URL"
