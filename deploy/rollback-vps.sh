#!/usr/bin/env bash
set -euo pipefail

RELEASE_ID=${1:?Použití: rollback-vps.sh <RELEASE_ID>}
APP_DIR=${APP_DIR:-/opt/meshcore-live-map}
SERVICE=${SERVICE:-meshcore-live-map.service}
HEALTH_PORT=${HEALTH_PORT:-4173}
APP_USER=${APP_USER:-meshcore-map}
APP_GROUP=${APP_GROUP:-meshcore-map}
BACKUP_FILE="$APP_DIR/backups/$RELEASE_ID.tar.gz"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Záloha nenalezena: $BACKUP_FILE" >&2
  echo "Dostupné zálohy:" >&2
  ls -1 "$APP_DIR/backups"/*.tar.gz 2>/dev/null | sed 's#.*/##; s#\.tar\.gz$##' >&2
  exit 1
fi

archive_has_node_modules() {
  tar -tzf "$BACKUP_FILE" 2>/dev/null | grep -qx 'node_modules/'
}

archive_lock_hash() {
  tar -xzOf "$BACKUP_FILE" package-lock.json 2>/dev/null | sha256sum | cut -d ' ' -f 1 || true
}

app_lock_hash() {
  sha256sum "$APP_DIR/package-lock.json" 2>/dev/null | cut -d ' ' -f 1 || true
}

keep_node_modules=false
if ! archive_has_node_modules; then
  current_lock=$(app_lock_hash)
  if [[ -n "$current_lock" && "$current_lock" == "$(archive_lock_hash)" && -d "$APP_DIR/node_modules" ]]; then
    keep_node_modules=true
  fi
fi

echo "Obnovuji $BACKUP_FILE (data zůstávají beze změny)"
systemctl stop "$SERVICE"
rm -rf "$APP_DIR/dist"
if [[ "$keep_node_modules" != true ]]; then
  rm -rf "$APP_DIR/node_modules"
fi
tar -xzf "$BACKUP_FILE" -C "$APP_DIR" --exclude='data'
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "Závislosti nejsou v záloze ani v aplikaci; instaluji z package-lock.json" >&2
  (cd "$APP_DIR" && npm ci --omit=dev)
fi
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
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
  echo "Rollback doběhl, ale služba neodpovídá na portu $HEALTH_PORT." >&2
  exit 1
fi

echo "Rollback dokončen: $RELEASE_ID"
