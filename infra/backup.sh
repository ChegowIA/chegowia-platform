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
file_backup_remote=$(read_env_value BACKUP_REMOTE "$ENV_FILE")
file_backup_rsync=$(read_env_value BACKUP_RSYNC_TARGET "$ENV_FILE")
DATA_ROOT=${DATA_ROOT:-${file_data_root:-/srv/chegowia/data}}
BACKUP_ROOT=${BACKUP_ROOT:-${file_backup_root:-/srv/chegowia/backups}}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-${file_retention_days:-14}}
MYSQL_DATABASE_NAME=${MYSQL_DATABASE:-${file_mysql_database:-chegowia}}
BACKUP_REMOTE=${BACKUP_REMOTE:-${file_backup_remote:-}}
BACKUP_RSYNC_TARGET=${BACKUP_RSYNC_TARGET:-${file_backup_rsync:-}}
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

# Marca o backup como imprestável em vez de deixá-lo parecendo bom.
abortar() {
  echo "$1" >&2
  mv -- "$TARGET" "$TARGET.FALHOU" 2>/dev/null || true
  echo "  O diretório foi renomeado para $TARGET.FALHOU." >&2
  exit 1
}

echo "Criando dump consistente do MySQL..."
# O status do mysqldump sai por arquivo porque em pipeline o `sh` só devolve o do
# último comando — o `gzip`. Sem isso, um dump que falhou (container
# reiniciando, senha errada, MySQL ocupado) gerava um .gz de 20 bytes e o script
# anunciava sucesso. O erro só apareceria no dia da restauração.
status_dump="$BACKUP_ROOT/.status-dump.$$"
(
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
    'exec mysqldump --single-transaction --quick --routines --triggers --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
  echo $? > "$status_dump"
) | gzip -9 > "$TARGET/database.sql.gz"
codigo_dump=$(cat "$status_dump" 2>/dev/null || echo 1)
rm -f "$status_dump"
[ "$codigo_dump" = "0" ] || abortar "O mysqldump falhou (código $codigo_dump). Backup NÃO foi gerado."

# O mysqldump termina com "-- Dump completed on ...". A ausência da linha revela
# truncamento — disco cheio no meio da escrita, conexão cortada — que o código de
# saída não pega.
if ! gzip -dc "$TARGET/database.sql.gz" | tail -5 | grep -q "Dump completed"; then
  abortar "O dump terminou truncado: falta a marca final do mysqldump."
fi

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
echo "Backup local concluído em $TARGET"

# ---------------------------------------------------------------------------
# Cópia fora do servidor
# ---------------------------------------------------------------------------
#
# Backup que mora no mesmo disco do banco não é backup: incêndio, disco morto ou
# conta do provedor encerrada levam o dado e a cópia juntos. E aqui há nota
# fiscal autorizada, que tem guarda obrigatória de cinco anos — perder isso não é
# só perder cliente.
#
# O destino é de quem opera: `BACKUP_REMOTE` para um remoto do rclone (a forma
# recomendada, porque um remoto do tipo `crypt` cifra antes de sair da máquina) ou
# `BACKUP_RSYNC_TARGET` para outra máquina por SSH. Sem nenhum dos dois o script
# avisa em vez de fingir que guardou.
if [ -z "$BACKUP_REMOTE" ] && [ -z "$BACKUP_RSYNC_TARGET" ]; then
  echo "" >&2
  echo "ATENÇÃO: nenhuma cópia externa configurada." >&2
  echo "  Este backup existe apenas em $BACKUP_ROOT, no mesmo servidor do banco." >&2
  echo "  Configure BACKUP_REMOTE (rclone) ou BACKUP_RSYNC_TARGET (ssh) em $ENV_FILE." >&2
  exit 2
fi

# Falha no envio não apaga o que já foi gerado: o backup local continua válido, e
# o código de saída diferente de zero é o que faz o cron reclamar em vez de a
# ausência da cópia passar meses sem ninguém notar.
if [ -n "$BACKUP_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || { echo "rclone não encontrado, mas BACKUP_REMOTE está definido." >&2; exit 1; }
  echo "Enviando para $BACKUP_REMOTE/$STAMP..."
  rclone copy --checksum "$TARGET" "$BACKUP_REMOTE/$STAMP"
  # Conferir depois de enviar: cópia truncada por queda de rede é silenciosa.
  rclone check --checksum "$TARGET" "$BACKUP_REMOTE/$STAMP"
  echo "Cópia externa verificada em $BACKUP_REMOTE/$STAMP"
fi

if [ -n "$BACKUP_RSYNC_TARGET" ]; then
  command -v rsync >/dev/null 2>&1 || { echo "rsync não encontrado, mas BACKUP_RSYNC_TARGET está definido." >&2; exit 1; }
  echo "Enviando para $BACKUP_RSYNC_TARGET/$STAMP..."
  rsync -a --checksum "$TARGET/" "$BACKUP_RSYNC_TARGET/$STAMP/"
  echo "Cópia externa enviada para $BACKUP_RSYNC_TARGET/$STAMP"
fi

# Registro do último envio bem-sucedido. É o que o check-production.sh lê para
# dizer se o agendamento está de fato rodando.
printf '%s\n' "$STAMP" > "$BACKUP_ROOT/ULTIMO_ENVIO_EXTERNO"
echo "Backup concluído."
