#!/bin/sh
set -eu

# ---------------------------------------------------------------------------
# Restauração do ChegowIA
# ---------------------------------------------------------------------------
#
# Espelha os dois modos do backup, e por um motivo prático: um backup que o
# nosso próprio script não restaura não é backup. O `infra/backup.sh` em modo
# remoto gera um diretório sem `files.tar.gz` — exigi-lo aqui recusava
# exatamente os backups da produção atual.
#
# REMOTO — `DATABASE_URL` aponta para o banco (hoje MySQL no Railway). A carga
#   vai pela rede e não há container para parar; quem tira a aplicação do ar é
#   quem opera, no painel do provedor. Está dito abaixo, antes de escrever nada.
#
# COMPOSE — o banco é o container do `compose.production.yml`. A aplicação é
#   parada e religada aqui mesmo.

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Restauração cancelada. Execute com CONFIRM_RESTORE=YES e BACKUP_DIR=/caminho/exato." >&2
  exit 1
fi

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}
BACKUP_DIR=${BACKUP_DIR:-}

if [ -z "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/database.sql.gz" ]; then
  echo "Backup inválido: $BACKUP_DIR não tem database.sql.gz" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  . "$PROJECT_DIR/infra/read-env.sh"
  ler() { read_env_value "$1" "$ENV_FILE"; }
else
  ler() { :; }
fi

DATABASE_URL=${DATABASE_URL:-$(ler DATABASE_URL)}
DATA_ROOT=${DATA_ROOT:-$(ler DATA_ROOT)}
DATA_ROOT=${DATA_ROOT:-/srv/chegowia/data}
case "$DATA_ROOT" in
  ""|"/"|"/home"|"/srv"|"/var") echo "DATA_ROOT é amplo demais: $DATA_ROOT" >&2; exit 1 ;;
esac

(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)

# ---------------------------------------------------------------------------
# Arquivos enviados: só quando o backup os trouxe
# ---------------------------------------------------------------------------
#
# Backup em modo remoto cobre o banco, não o disco de quem serve a API. Recusar
# a restauração por causa disso seria recusar o backup da produção.
COM_ARQUIVOS=nao
if [ -f "$BACKUP_DIR/files.tar.gz" ]; then
  COM_ARQUIVOS=sim
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
fi

# ---------------------------------------------------------------------------
# Para onde a carga vai
# ---------------------------------------------------------------------------

if [ -n "$DATABASE_URL" ]; then
  MODO=remoto
elif command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  MODO=compose
else
  echo "Não sei para onde restaurar." >&2
  echo "  Defina DATABASE_URL (banco alcançável pela rede) ou rode no host que tem" >&2
  echo "  docker e $COMPOSE_FILE." >&2
  exit 1
fi

echo "Modo: $MODO. Arquivos no backup: $COM_ARQUIVOS."

mysql_remoto() {
  if command -v docker >/dev/null 2>&1; then
    tls=""
    [ "${BACKUP_REQUIRE_TLS:-true}" = "true" ] && tls="--ssl-mode=REQUIRED"
    docker run --rm -i -e MYSQL_PWD mysql:8.4 mysql $tls "$@"
  elif command -v mysql >/dev/null 2>&1; then
    mysql "$@"
  else
    echo "Nem docker nem cliente mysql disponíveis para a carga." >&2
    return 127
  fi
}

if [ "$MODO" = "remoto" ]; then
  command -v node >/dev/null 2>&1 || { echo "O modo remoto usa node para ler a DATABASE_URL." >&2; exit 1; }
  url_host=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.hostname)")
  url_port=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.port||3306)")
  url_user=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(decodeURIComponent(u.username))")
  url_pass=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(decodeURIComponent(u.password))")
  url_db=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.pathname.replace(/^\//,''))")
  export MYSQL_PWD="$url_pass"

  # Não há container para parar aqui. Escrever com a API no ar deixa a aplicação
  # lendo um banco sendo recriado por baixo — e é o operador, no painel do
  # provedor, quem pode suspender o serviço.
  echo ""
  echo "ATENÇÃO: em modo remoto este script não para a aplicação."
  echo "  Suspenda a API no painel do provedor antes de continuar; restaurar com"
  echo "  ela no ar mistura dado antigo e novo na mesma sessão de uso."
  echo "  Banco de destino: $url_db em $url_host:$url_port"
  echo ""
  if [ "${CONFIRM_RESTORE_REMOTO:-}" != "YES" ]; then
    echo "Confirme também com CONFIRM_RESTORE_REMOTO=YES." >&2
    exit 1
  fi

  echo "Recriando o banco..."
  mysql_remoto --host="$url_host" --port="$url_port" --user="$url_user" \
    -e "DROP DATABASE IF EXISTS \`$url_db\`; CREATE DATABASE \`$url_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  echo "Carregando o dump..."
  gzip -dc "$BACKUP_DIR/database.sql.gz" \
    | mysql_remoto --host="$url_host" --port="$url_port" --user="$url_user" "$url_db"
  unset MYSQL_PWD
else
  echo "Parando aplicações durante a restauração..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api web
  trap 'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start api web >/dev/null 2>&1 || true' EXIT

  echo "Restaurando banco de dados..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
    'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"'
  gzip -dc "$BACKUP_DIR/database.sql.gz" \
    | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
      'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
fi

if [ "$COM_ARQUIVOS" = "sim" ]; then
  echo "Restaurando arquivos locais..."
  mkdir -p "$DATA_ROOT"
  tar -C "$DATA_ROOT" -xzf "$BACKUP_DIR/files.tar.gz"
else
  echo "Este backup não traz arquivos enviados: imagem e documento ficam como estão."
fi

if [ "$MODO" = "compose" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start api web
  trap - EXIT
fi
echo "Restauração concluída."
