#!/usr/bin/env bash
set -euo pipefail

# Bootstrap instalace MeshCore CZ Live Map na nový Debian/Ubuntu VPS.
# Spouštějte jako root z klonu repozitáře:
#   sudo DOMAIN=mapa.example.cz INSTALL_NGINX=1 bash deploy/install-vps.sh
#
# Skript je idempotentní: existující .env, data/ a uploads/ zachová.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INSTANCE=${INSTANCE:-prod}
FORCE_NGINX=${FORCE_NGINX:-0}
INSTALL_NGINX=${INSTALL_NGINX:-0}
NODE_MAJOR=${NODE_MAJOR:-22}
SKIP_APT=${SKIP_APT:-0}
DOMAIN=${DOMAIN:-}

case "$INSTANCE" in
  prod|production)
    APP_DIR=${APP_DIR:-/opt/meshcore-live-map}
    APP_USER=${APP_USER:-meshcore-map}
    APP_GROUP=${APP_GROUP:-meshcore-map}
    SERVICE=${SERVICE:-meshcore-live-map.service}
    PORT=${PORT:-4173}
    UNIT_SOURCE="$ROOT_DIR/deploy/meshcore-live-map.service"
    STORAGE_SOURCE="$ROOT_DIR/deploy/meshcore-live-map-storage.conf"
    VITE_BASE_PATH=${VITE_BASE_PATH:-/}
    VITE_BETA=${VITE_BETA:-0}
    ;;
  beta|stage)
    APP_DIR=${APP_DIR:-/opt/meshcore-live-map-stage}
    APP_USER=${APP_USER:-meshcore-map}
    APP_GROUP=${APP_GROUP:-meshcore-map}
    SERVICE=${SERVICE:-meshcore-live-map-stage.service}
    PORT=${PORT:-4174}
    UNIT_SOURCE="$ROOT_DIR/deploy/meshcore-live-map-stage.service"
    STORAGE_SOURCE="$ROOT_DIR/deploy/meshcore-live-map-stage-storage.conf"
    VITE_BASE_PATH=${VITE_BASE_PATH:-/beta/}
    VITE_BETA=${VITE_BETA:-1}
    ;;
  *)
    echo "Neznámý INSTANCE: $INSTANCE (použijte prod nebo stage)" >&2
    exit 1
    ;;
esac

if [[ $EUID -ne 0 ]]; then
  echo "Spusťte jako root: sudo bash deploy/install-vps.sh" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Tento skript podporuje Debian/Ubuntu (apt-get)." >&2
  exit 1
fi

if [[ "$INSTALL_NGINX" == "1" && "$INSTANCE" != "prod" && "$INSTANCE" != "production" ]]; then
  echo "Nginx pro beta instanci se neinstaluje automaticky; použijte deploy/nginx-mapa-beta-location.conf." >&2
  exit 1
fi

if [[ "$INSTALL_NGINX" == "1" && -z "$DOMAIN" ]]; then
  echo "Pro INSTALL_NGINX=1 nastavte DOMAIN (např. DOMAIN=mapa.example.cz)." >&2
  exit 1
fi

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)'
}

install_system_packages() {
  if [[ "$SKIP_APT" == "1" ]]; then
    return
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  packages=(ca-certificates curl gnupg build-essential python3 git rsync)
  if [[ "$INSTALL_NGINX" == "1" ]]; then
    packages+=(nginx)
  fi
  apt-get install -y "${packages[@]}"

  if ! node_ok; then
    echo "Instaluji Node.js ${NODE_MAJOR}.x z NodeSource…"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
}

create_user_and_dirs() {
  if ! getent group "$APP_GROUP" >/dev/null; then
    groupadd --system "$APP_GROUP"
  fi
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_GROUP" -m 750 \
    "$APP_DIR" "$APP_DIR/data" "$APP_DIR/uploads" "$APP_DIR/backups"
}

copy_application() {
  if [[ "$ROOT_DIR" == "$APP_DIR" ]]; then
    return
  fi
  rsync -a \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'data' \
    --exclude 'uploads' \
    --exclude 'backups' \
    --exclude '.env' \
    --exclude '.deploy.env' \
    --exclude 'cntb' \
    --exclude 'cntb.pub' \
    --exclude '.opencode' \
    "$ROOT_DIR/" "$APP_DIR/"
}

prepare_environment() {
  if [[ ! -f "$APP_DIR/.env" ]]; then
    install -m 600 -o "$APP_USER" -g "$APP_GROUP" "$APP_DIR/.env.example" "$APP_DIR/.env"
    if [[ -n "$DOMAIN" ]]; then
      sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" "$APP_DIR/.env"
    fi
    echo "Vytvořen $APP_DIR/.env z .env.example – doplňte MQTT a přístupové tokeny."
  fi
  chown "$APP_USER:$APP_GROUP" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
}

build_application() {
  cd "$APP_DIR"
  npm ci
  VITE_BASE_PATH="$VITE_BASE_PATH" VITE_BETA="$VITE_BETA" npm run build
  npm prune --omit=dev
  chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
}

install_service() {
  local unit_target="/etc/systemd/system/$SERVICE"
  local override_dir="/etc/systemd/system/$SERVICE.d"
  local override_file="$override_dir/storage.conf"
  local node_bin
  node_bin=$(command -v node)

  sed \
    -e "s#/opt/meshcore-live-map-stage#$APP_DIR#g" \
    -e "s#/opt/meshcore-live-map#$APP_DIR#g" \
    -e "s#/usr/bin/node#$node_bin#g" \
    -e "s#^User=.*#User=$APP_USER#" \
    -e "s#^Group=.*#Group=$APP_GROUP#" \
    -e "s#^Environment=PORT=.*#Environment=PORT=$PORT#" \
    "$UNIT_SOURCE" > "$unit_target"
  chmod 644 "$unit_target"
  chown root:root "$unit_target"

  install -d -m 755 "$override_dir"
  sed -e "s#/opt/meshcore-live-map-stage#$APP_DIR#g" \
      -e "s#/opt/meshcore-live-map#$APP_DIR#g" \
      "$STORAGE_SOURCE" > "$override_file"
  chmod 644 "$override_file"
  chown root:root "$override_file"

  install -m 755 -o root -g root "$ROOT_DIR/deploy/rollback-vps.sh" /root/rollback-meshcore.sh
}

install_nginx() {
  if [[ "$INSTALL_NGINX" != "1" ]]; then
    return
  fi
  local site=meshcore-live-map
  local target="/etc/nginx/sites-available/$site"
  if [[ -e "$target" && "$FORCE_NGINX" != "1" ]]; then
    echo "Nginx konfigurace $target už existuje; ponechávám ji. Pro přepsání použijte FORCE_NGINX=1."
    return
  fi
  sed \
    -e "s/server_name mapa.meshcore.cz;/server_name $DOMAIN;/" \
    -e "s#127.0.0.1:4173#127.0.0.1:$PORT#g" \
    "$ROOT_DIR/deploy/nginx-mapa-meshcore.conf" > "$target"
  ln -sfn "$target" "/etc/nginx/sites-enabled/$site"
  nginx -t
  systemctl reload nginx
}

start_service() {
  systemctl daemon-reload
  systemctl enable "$SERVICE"
  systemctl restart "$SERVICE"

  local healthy=0
  for _ in $(seq 1 30); do
    if systemctl is-active --quiet "$SERVICE" \
      && curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 1
  done

  if [[ "$healthy" != "1" ]]; then
    echo "Služba $SERVICE neodpovídá na http://127.0.0.1:$PORT/api/health." >&2
    journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
    exit 1
  fi

  echo
  echo "Instalace dokončena."
  echo "  Instance: $INSTANCE"
  echo "  Adresář:  $APP_DIR"
  echo "  Služba:   $SERVICE"
  echo "  Port:     $PORT"
  if [[ "$INSTALL_NGINX" == "1" ]]; then
    echo "  Nginx:    http://$DOMAIN/ (TLS doplňte např. přes certbot)"
  fi
  echo
  echo "Doplňte $APP_DIR/.env a poté spusťte: systemctl restart $SERVICE"
}

install_system_packages
create_user_and_dirs
copy_application
prepare_environment
build_application
install_service
install_nginx
start_service
