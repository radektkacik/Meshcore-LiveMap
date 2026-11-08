#!/usr/bin/env bash
set -euo pipefail

STAGE=${1:?Missing staging directory}
RELEASE_ID=${2:?Missing release ID}
APP_DIR=${APP_DIR:-/opt/meshcore-live-map}
BACKUP_DIR="$APP_DIR/backups"
BACKUP_FILE="$BACKUP_DIR/$RELEASE_ID.tar.gz"
BACKUP_RETENTION=20
SERVICE=${SERVICE:-meshcore-live-map.service}
OVERRIDE_DIR=${OVERRIDE_DIR:-/etc/systemd/system/${SERVICE}.d}
OVERRIDE_FILE="$OVERRIDE_DIR/storage.conf"
STORAGE_CONF_NAME=${STORAGE_CONF_NAME:-meshcore-live-map-storage.conf}
HEALTH_PORT=${HEALTH_PORT:-4173}
APP_USER=${APP_USER:-meshcore-map}
APP_GROUP=${APP_GROUP:-meshcore-map}
ROLLBACK_SCRIPT=${ROLLBACK_SCRIPT:-/root/rollback-meshcore.sh}

for file in server.mjs http-server.mjs admin-auth.mjs monitor.mjs mqtt-ingest.mjs collectors.mjs elevation-terrain.mjs backend-utils.mjs node-metrics.mjs packet-store.mjs cz-health.mjs cz-health-store.mjs visit-stats.mjs feedback.mjs photos.mjs node-info.mjs comments.mjs repeater-pages.mjs notify.mjs html.mjs sqlite-store.mjs admin-pages.mjs legacy-pages.mjs http-utils.mjs package.json package-lock.json dist/index.html \
  rollback-vps.sh \
  "$STORAGE_CONF_NAME" \
  node_modules/@michaelhart/meshcore-decoder/package.json \
  node_modules/better-sqlite3/package.json; do
  test -f "$STAGE/$file"
done

cd "$STAGE"
node --check server.mjs
node --check http-server.mjs
node --check admin-auth.mjs
node --check monitor.mjs
node --check mqtt-ingest.mjs
node --check collectors.mjs
node --check elevation-terrain.mjs
node --check backend-utils.mjs
node --check node-metrics.mjs
node --check packet-store.mjs
node --check cz-health.mjs
node --check cz-health-store.mjs
node --check visit-stats.mjs
node --check feedback.mjs
node --check photos.mjs
node --check node-info.mjs
node --check comments.mjs
node --check repeater-pages.mjs
node --check notify.mjs
node --check html.mjs
node --check sqlite-store.mjs
node --check admin-pages.mjs
node --check legacy-pages.mjs
node --check http-utils.mjs
node --input-type=module -e 'import("@michaelhart/meshcore-decoder")'
node --input-type=module -e 'import("better-sqlite3")'

mkdir -p "$BACKUP_DIR" "$APP_DIR/data" "$APP_DIR/uploads"
chown "$APP_USER:$APP_GROUP" "$APP_DIR/data" "$APP_DIR/uploads"

archive_has_node_modules() {
  tar -tzf "$BACKUP_FILE" 2>/dev/null | grep -qx 'node_modules/'
}

archive_lock_hash() {
  tar -xzOf "$BACKUP_FILE" package-lock.json 2>/dev/null | sha256sum | cut -d ' ' -f 1 || true
}

app_lock_hash() {
  sha256sum "$APP_DIR/package-lock.json" 2>/dev/null | cut -d ' ' -f 1 || true
}

rollback() {
  systemctl stop "$SERVICE" || true
  keep_node_modules=false
  if ! archive_has_node_modules; then
    current_lock=$(app_lock_hash)
    if [[ -n "$current_lock" && "$current_lock" == "$(archive_lock_hash)" && -d "$APP_DIR/node_modules" ]]; then
      keep_node_modules=true
    fi
  fi
  rm -rf "$APP_DIR/dist" "$APP_DIR/data"
  if [[ "$keep_node_modules" != true ]]; then
    rm -rf "$APP_DIR/node_modules"
  fi
  rm -f "$APP_DIR/http-server.mjs" "$APP_DIR/admin-auth.mjs" "$APP_DIR/monitor.mjs" "$APP_DIR/mqtt-ingest.mjs" "$APP_DIR/collectors.mjs" "$APP_DIR/elevation-terrain.mjs" "$APP_DIR/backend-utils.mjs" "$APP_DIR/node-metrics.mjs" "$APP_DIR/packet-store.mjs" "$APP_DIR/cz-health.mjs" "$APP_DIR/cz-health-store.mjs" "$APP_DIR/visit-stats.mjs" "$APP_DIR/feedback.mjs" "$APP_DIR/photos.mjs" "$APP_DIR/node-info.mjs" "$APP_DIR/comments.mjs" "$APP_DIR/repeater-pages.mjs" "$APP_DIR/notify.mjs" "$APP_DIR/html.mjs" "$APP_DIR/sqlite-store.mjs" "$APP_DIR/admin-pages.mjs" "$APP_DIR/legacy-pages.mjs" "$APP_DIR/http-utils.mjs"
  tar -xzf "$BACKUP_FILE" -C "$APP_DIR"
  if [[ ! -d "$APP_DIR/node_modules" ]]; then
    echo "Závislosti nejsou v záloze ani v aplikaci; instaluji z package-lock.json" >&2
    (cd "$APP_DIR" && npm ci --omit=dev)
  fi
  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
  chmod 600 "$APP_DIR/.env"
  if [[ -f "$STAGE/previous-storage.conf" ]]; then
    install -o root -g root -m 644 "$STAGE/previous-storage.conf" "$OVERRIDE_FILE"
  else
    rm -f "$OVERRIDE_FILE"
  fi
  systemctl daemon-reload
  systemctl start "$SERVICE"
}

swap_started=false
service_stopped=false
rollback_on_error() {
  status=$?
  trap - ERR
  if [[ "$swap_started" == true ]]; then
    rollback
    echo "Deployment failed; restored $BACKUP_FILE" >&2
  elif [[ "$service_stopped" == true ]]; then
    systemctl start "$SERVICE"
  fi
  exit "$status"
}
trap rollback_on_error ERR

systemctl stop "$SERVICE"
service_stopped=true
backup_paths=(server.mjs package.json package-lock.json dist data)
if [[ -f "$APP_DIR/http-server.mjs" ]]; then
  backup_paths+=(http-server.mjs)
fi
if [[ -f "$APP_DIR/admin-auth.mjs" ]]; then
  backup_paths+=(admin-auth.mjs)
fi
if [[ -f "$APP_DIR/monitor.mjs" ]]; then
  backup_paths+=(monitor.mjs)
fi
if [[ -f "$APP_DIR/mqtt-ingest.mjs" ]]; then
  backup_paths+=(mqtt-ingest.mjs)
fi
if [[ -f "$APP_DIR/collectors.mjs" ]]; then
  backup_paths+=(collectors.mjs)
fi
if [[ -f "$APP_DIR/elevation-terrain.mjs" ]]; then
  backup_paths+=(elevation-terrain.mjs)
fi
if [[ -f "$APP_DIR/node-metrics.mjs" ]]; then
  backup_paths+=(node-metrics.mjs)
fi
if [[ -f "$APP_DIR/backend-utils.mjs" ]]; then
  backup_paths+=(backend-utils.mjs)
fi
if [[ -f "$APP_DIR/packet-store.mjs" ]]; then
  backup_paths+=(packet-store.mjs)
fi
if [[ -f "$APP_DIR/cz-health.mjs" ]]; then
  backup_paths+=(cz-health.mjs)
fi
if [[ -f "$APP_DIR/cz-health-store.mjs" ]]; then
  backup_paths+=(cz-health-store.mjs)
fi
if [[ -f "$APP_DIR/visit-stats.mjs" ]]; then
  backup_paths+=(visit-stats.mjs)
fi
if [[ -f "$APP_DIR/feedback.mjs" ]]; then
  backup_paths+=(feedback.mjs)
fi
if [[ -f "$APP_DIR/photos.mjs" ]]; then
  backup_paths+=(photos.mjs)
fi
if [[ -f "$APP_DIR/node-info.mjs" ]]; then
  backup_paths+=(node-info.mjs)
fi
if [[ -f "$APP_DIR/comments.mjs" ]]; then
  backup_paths+=(comments.mjs)
fi
if [[ -f "$APP_DIR/repeater-pages.mjs" ]]; then
  backup_paths+=(repeater-pages.mjs)
fi
if [[ -f "$APP_DIR/notify.mjs" ]]; then
  backup_paths+=(notify.mjs)
fi
if [[ -f "$APP_DIR/html.mjs" ]]; then
  backup_paths+=(html.mjs)
fi
if [[ -f "$APP_DIR/sqlite-store.mjs" ]]; then
  backup_paths+=(sqlite-store.mjs)
fi
if [[ -f "$APP_DIR/admin-pages.mjs" ]]; then
  backup_paths+=(admin-pages.mjs)
fi
if [[ -f "$APP_DIR/legacy-pages.mjs" ]]; then
  backup_paths+=(legacy-pages.mjs)
fi
if [[ -f "$APP_DIR/http-utils.mjs" ]]; then
  backup_paths+=(http-utils.mjs)
fi
existing_backup_paths=()
for path in "${backup_paths[@]}"; do
  [[ -e "$APP_DIR/$path" ]] && existing_backup_paths+=("$path")
done
if ((${#existing_backup_paths[@]})); then
  tar -czf "$BACKUP_FILE" -C "$APP_DIR" "${existing_backup_paths[@]}"
else
  tar -czf "$BACKUP_FILE" -C "$APP_DIR" --files-from /dev/null
fi
mkdir -p "$(dirname "$ROLLBACK_SCRIPT")"
install -o root -g root -m 755 "$STAGE/rollback-vps.sh" "$ROLLBACK_SCRIPT"
mkdir -p "$OVERRIDE_DIR"
if [[ -f "$OVERRIDE_FILE" ]]; then
  cp "$OVERRIDE_FILE" "$STAGE/previous-storage.conf"
fi
swap_started=true
install -o root -g root -m 644 "$STAGE/$STORAGE_CONF_NAME" "$OVERRIDE_FILE"
systemctl daemon-reload
rm -rf "$APP_DIR/dist" "$APP_DIR/node_modules"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/server.mjs" "$APP_DIR/server.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/http-server.mjs" "$APP_DIR/http-server.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/admin-auth.mjs" "$APP_DIR/admin-auth.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/monitor.mjs" "$APP_DIR/monitor.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/mqtt-ingest.mjs" "$APP_DIR/mqtt-ingest.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/collectors.mjs" "$APP_DIR/collectors.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/elevation-terrain.mjs" "$APP_DIR/elevation-terrain.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/backend-utils.mjs" "$APP_DIR/backend-utils.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/node-metrics.mjs" "$APP_DIR/node-metrics.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/packet-store.mjs" "$APP_DIR/packet-store.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/cz-health.mjs" "$APP_DIR/cz-health.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/cz-health-store.mjs" "$APP_DIR/cz-health-store.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/visit-stats.mjs" "$APP_DIR/visit-stats.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/feedback.mjs" "$APP_DIR/feedback.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/photos.mjs" "$APP_DIR/photos.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/node-info.mjs" "$APP_DIR/node-info.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/comments.mjs" "$APP_DIR/comments.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/repeater-pages.mjs" "$APP_DIR/repeater-pages.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/notify.mjs" "$APP_DIR/notify.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/html.mjs" "$APP_DIR/html.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/sqlite-store.mjs" "$APP_DIR/sqlite-store.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/admin-pages.mjs" "$APP_DIR/admin-pages.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/legacy-pages.mjs" "$APP_DIR/legacy-pages.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/http-utils.mjs" "$APP_DIR/http-utils.mjs"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/package.json" "$APP_DIR/package.json"
install -o "$APP_USER" -g "$APP_GROUP" -m 644 "$STAGE/package-lock.json" "$APP_DIR/package-lock.json"
mv "$STAGE/dist" "$APP_DIR/dist"
mv "$STAGE/node_modules" "$APP_DIR/node_modules"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/dist" "$APP_DIR/node_modules"
systemctl start "$SERVICE"

healthy=false
for _ in $(seq 1 15); do
  if systemctl is-active --quiet "$SERVICE" \
    && curl --fail --silent --max-time 3 "http://127.0.0.1:$HEALTH_PORT/" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  false
fi
swap_started=false
service_stopped=false

mapfile -t backups < <(printf '%s\n' "$BACKUP_DIR"/*.tar.gz | sort -r)
if ((${#backups[@]} > BACKUP_RETENTION)); then
  rm -f -- "${backups[@]:BACKUP_RETENTION}"
fi

echo "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f 1))"
