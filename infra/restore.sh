#!/bin/sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Restauração cancela. Execute com CONFIRM_RESTORE=YES e BACKUP_DIR=/caminho/exato." >&2
  exit 1
fi

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}
BACKUP_DIR=${BACKUP_DIR:-}

if [ -z "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/database.sql.gz" ] || [ ! -f "$BACKUP_DIR/files.tar.gz" ]; then
  echo "Backup inválido ou incompleto: $BACKUP_DIR" >&2
  exit 1
fi

. "$PROJECT_DIR/infra/read-env.sh"
file_data_root=$(read_env_value DATA_ROOT "$ENV_FILE")
DATA_ROOT=${DATA_ROOT:-${file_data_root:-/srv/chegowia/data}}
case "$DATA_ROOT" in
  ""|"/"|"/home"|"/srv"|"/var") echo "DATA_ROOT é amplo demais: $DATA_ROOT" >&2; exit 1 ;;
esac

(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
if ! tar -tzf "$BACKUP_DIR/files.tar.gz" | awk '
  /^uploads(\/|$)/ || /^private_uploads(\/|$)/ { next }
  { exit 1 }
'; then
  echo "O arquivo de backup contém caminhos inesperados e foi recusado." >&2
  exit 1
fi
if ! tar -tvzf "$BACKUP_DIR/files.tar.gz" | awk '
  {
    type = substr($1, 1, 1)
    if (type != "d" && type != "-") exit 1
  }
'; then
  echo "O arquivo de backup contém links ou tipos especiais e foi recusado." >&2
  exit 1
fi
if [ -L "$DATA_ROOT/uploads" ] || [ -L "$DATA_ROOT/private_uploads" ]; then
  echo "A restauração foi recusada porque um diretório de dados é um link simbólico." >&2
  exit 1
fi

echo "Parando aplicações durante a restauração..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api web
trap 'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start api web >/dev/null 2>&1 || true' EXIT

echo "Restaurando banco de dados..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
gzip -dc "$BACKUP_DIR/database.sql.gz" \
  | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
    'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

echo "Restaurando arquivos locais..."
mkdir -p "$DATA_ROOT"
tar -C "$DATA_ROOT" -xzf "$BACKUP_DIR/files.tar.gz"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start api web
trap - EXIT
echo "Restauração concluída."
