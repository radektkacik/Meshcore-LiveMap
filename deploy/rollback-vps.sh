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

echo "Obnovuji $BACKUP_FILE (data zůstávají beze změny)"
systemctl stop "$SERVICE"
rm -rf "$APP_DIR/dist" "$APP_DIR/node_modules"
tar -xzf "$BACKUP_FILE" -C "$APP_DIR" --exclude='data'
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
