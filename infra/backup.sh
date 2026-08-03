#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo de ambiente não encontrado: $ENV_FILE" >&2
  exit 1
fi

. "$PROJECT_DIR/infra/read-env.sh"

file_data_root=$(read_env_value DATA_ROOT "$ENV_FILE")
file_backup_root=$(read_env_value BACKUP_ROOT "$ENV_FILE")
file_retention_days=$(read_env_value BACKUP_RETENTION_DAYS "$ENV_FILE")
file_mysql_database=$(read_env_value MYSQL_DATABASE "$ENV_FILE")
DATA_ROOT=${DATA_ROOT:-${file_data_root:-/srv/chegowia/data}}
BACKUP_ROOT=${BACKUP_ROOT:-${file_backup_root:-/srv/chegowia/backups}}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-${file_retention_days:-14}}
MYSQL_DATABASE_NAME=${MYSQL_DATABASE:-${file_mysql_database:-chegowia}}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_ROOT/$STAMP"

case "$DATA_ROOT" in
  ""|"/"|"/home"|"/srv"|"/var") echo "DATA_ROOT é amplo demais: $DATA_ROOT" >&2; exit 1 ;;
esac
case "$BACKUP_ROOT" in
  ""|"/"|"/home"|"/srv"|"/var") echo "BACKUP_ROOT é amplo demais: $BACKUP_ROOT" >&2; exit 1 ;;
esac
case "$RETENTION_DAYS" in
  ""|*[!0-9]*) echo "BACKUP_RETENTION_DAYS precisa ser um número inteiro." >&2; exit 1 ;;
esac
backup_basename=$(basename -- "$BACKUP_ROOT")
case "$backup_basename" in
  *backup*|*Backup*) ;;
  *) echo "BACKUP_ROOT precisa apontar para um diretório dedicado de backups: $BACKUP_ROOT" >&2; exit 1 ;;
esac

umask 077
mkdir -p "$TARGET"

echo "Criando dump consistente do MySQL..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
  'exec mysqldump --single-transaction --quick --routines --triggers --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip -9 > "$TARGET/database.sql.gz"

echo "Copiando arquivos públicos e privados..."
mkdir -p "$DATA_ROOT/uploads" "$DATA_ROOT/private_uploads"
tar -C "$DATA_ROOT" -czf "$TARGET/files.tar.gz" uploads private_uploads

cat > "$TARGET/manifest.txt" <<EOF
created_at=$STAMP
database=$MYSQL_DATABASE_NAME
hostname=$(hostname)
EOF
(cd "$TARGET" && sha256sum database.sql.gz files.tar.gz manifest.txt > SHA256SUMS)

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
echo "Backup concluído em $TARGET"
