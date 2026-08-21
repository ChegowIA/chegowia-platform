#!/bin/sh
set -eu

# ---------------------------------------------------------------------------
# Backup do ChegowIA
# ---------------------------------------------------------------------------
#
# Existem duas topologias em uso, e o script decide sozinho qual é:
#
# REMOTO — o banco está em outro provedor (hoje: MySQL no Railway, API no
#   Render), alcançável pela rede. O dump sai daqui mesmo, com `DATABASE_URL`.
#   Roda de qualquer máquina: a sua, um cron job do provedor, uma esteira.
#
# COMPOSE — o banco é o container do `compose.production.yml`, que não publica
#   porta e só é alcançável por dentro. Ali o dump sai por `docker compose exec`,
#   e exige rodar no host — não dentro do container da API, que não tem docker.
#
# O que este backup cobre: o banco. É lá que estão XML de NFC-e, protocolo de
# autorização e o próprio certificado A1 (cifrado) — ou seja, é ele que carrega
# a guarda obrigatória de cinco anos e todo o dado de negócio.
#
# O que não cobre em modo remoto: os arquivos enviados (imagem de produto, logo,
# documento). Eles ficam no disco de quem serve a API, e esse disco não é
# alcançável de fora. Quando o script roda onde o disco está, ele entra no
# backup; quando não, o aviso é explícito e a cobertura fica com o snapshot de
# disco do provedor.

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}

# O arquivo de ambiente é opcional: quem dumpa um banco remoto da própria
# máquina passa `DATABASE_URL` na linha de comando, e exigir o arquivo só faria
# o script recusar o caso mais simples.
if [ -f "$ENV_FILE" ]; then
  . "$PROJECT_DIR/infra/read-env.sh"
  ler() { read_env_value "$1" "$ENV_FILE"; }
else
  ler() { :; }
fi

DATABASE_URL=${DATABASE_URL:-$(ler DATABASE_URL)}
DATA_ROOT=${DATA_ROOT:-$(ler DATA_ROOT)}
BACKUP_ROOT=${BACKUP_ROOT:-$(ler BACKUP_ROOT)}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-$(ler BACKUP_RETENTION_DAYS)}
MYSQL_DATABASE_NAME=${MYSQL_DATABASE:-$(ler MYSQL_DATABASE)}
BACKUP_REMOTE=${BACKUP_REMOTE:-$(ler BACKUP_REMOTE)}
BACKUP_RSYNC_TARGET=${BACKUP_RSYNC_TARGET:-$(ler BACKUP_RSYNC_TARGET)}
BACKUP_ALLOW_LOCAL_ONLY=${BACKUP_ALLOW_LOCAL_ONLY:-$(ler BACKUP_ALLOW_LOCAL_ONLY)}
BACKUP_REQUIRE_TLS=${BACKUP_REQUIRE_TLS:-$(ler BACKUP_REQUIRE_TLS)}
DATA_ROOT=${DATA_ROOT:-/srv/chegowia/data}
BACKUP_ROOT=${BACKUP_ROOT:-$PROJECT_DIR/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
MYSQL_DATABASE_NAME=${MYSQL_DATABASE_NAME:-chegowia}
BACKUP_REQUIRE_TLS=${BACKUP_REQUIRE_TLS:-true}
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

externo="nao"

# Registro do último backup: quando aconteceu e se saiu da máquina. É o que o
# check-production.sh lê para dizer se o agendamento está de fato rodando — a
# linha de cron podia nunca ter sido instalada, e isso não dá sintoma até o dia
# em que o backup é necessário.
registrar_marca() {
  printf 'stamp=%s\nexterno=%s\n' "$STAMP" "$externo" > "$BACKUP_ROOT/ULTIMO_BACKUP"
}

# Marca o backup como imprestável em vez de deixá-lo parecendo bom.
abortar() {
  echo "$1" >&2
  mv -- "$TARGET" "$TARGET.FALHOU" 2>/dev/null || true
  echo "  O diretório foi renomeado para $TARGET.FALHOU." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Como o dump vai sair
# ---------------------------------------------------------------------------

if [ -n "$DATABASE_URL" ]; then
  MODO=remoto
elif command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  MODO=compose
else
  echo "Não sei de onde tirar o dump." >&2
  echo "  Defina DATABASE_URL (banco alcançável pela rede) ou rode no host que tem" >&2
  echo "  docker e $COMPOSE_FILE." >&2
  echo "  Dentro do container da API nenhum dos dois existe — ele não tem docker" >&2
  echo "  nem o repositório." >&2
  exit 1
fi

# A imagem oficial vem primeiro, e não o binário do sistema.
#
# O `mysqldump` instalado na máquina pode ser o do MariaDB, que recusa opções do
# MySQL 8 (`set-gtid-purged` foi a que apareceu no ensaio) e derruba o dump por
# incompatibilidade de cliente, não por problema no banco. Com docker à mão, usar
# a imagem da mesma versão do servidor elimina essa classe de erro inteira.
#
# Sem docker, cai no binário do sistema com o conjunto conservador de opções — o
# dump sai igual, só sem os ajustes específicos do MySQL 8.
mysqldump_remoto() {
  # Banco em localhost é o caso do desenvolvimento, e ali o container do docker
  # não alcança 127.0.0.1 da máquina — aquele endereço é ele mesmo. Nesse caso o
  # binário do sistema vem primeiro; o conjunto de opções já é o conservador,
  # então funciona também com o cliente do MariaDB.
  case "${1:-}" in
    --host=localhost|--host=127.0.0.1|--host=::1)
      if command -v mysqldump >/dev/null 2>&1; then mysqldump "$@"; return $?; fi
      if command -v docker >/dev/null 2>&1; then
        docker run --rm -i --network host -e MYSQL_PWD mysql:8.4 mysqldump --set-gtid-purged=OFF "$@"
        return $?
      fi
      ;;
  esac
  if command -v docker >/dev/null 2>&1; then
    # Banco remoto significa dump atravessando a internet com endereço de
    # cliente, CPF, CNPJ e documento fiscal dentro. `REQUIRED` cifra a conexão;
    # ele não valida a autoridade certificadora, então protege contra escuta
    # passiva, não contra um intermediário ativo. Validar a CA exigiria o
    # certificado do provedor, que muda por provedor — é o próximo passo se o
    # banco sair da rede privada de vez.
    tls=""
    [ "$BACKUP_REQUIRE_TLS" = "true" ] && tls="--ssl-mode=REQUIRED"
    docker run --rm -i -e MYSQL_PWD mysql:8.4 mysqldump --set-gtid-purged=OFF $tls "$@"
  elif command -v mysqldump >/dev/null 2>&1; then
    mysqldump "$@"
  else
    echo "Nem docker nem mysqldump disponíveis para gerar o dump." >&2
    return 127
  fi
}

# A senha vai por variável de ambiente, não por argumento: argumento aparece na
# lista de processos de quem estiver na mesma máquina.
dump_remoto() {
  url_host=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.hostname)")
  url_port=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.port||3306)")
  url_user=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(decodeURIComponent(u.username))")
  url_pass=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(decodeURIComponent(u.password))")
  url_db=$(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.pathname.replace(/^\//,''))")
  MYSQL_DATABASE_NAME=${url_db:-$MYSQL_DATABASE_NAME}
  # `MYSQL_PWD=x funcao` não repassa a variável para dentro de uma função em sh —
  # o dump saía como login sem senha e só funcionaria contra um banco que aceita
  # isso. Exportar é o que faz a senha chegar ao cliente, e ela nunca vai por
  # argumento porque argumento aparece na lista de processos da máquina.
  export MYSQL_PWD="$url_pass"
  mysqldump_remoto \
    --host="$url_host" --port="$url_port" --user="$url_user" \
    --single-transaction --quick --routines --triggers --events --no-tablespaces \
    "$url_db"
  codigo=$?
  unset MYSQL_PWD
  return $codigo
}

dump_compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql sh -c \
    'exec mysqldump --single-transaction --quick --routines --triggers --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
}

command -v node >/dev/null 2>&1 || {
  [ "$MODO" = "compose" ] || { echo "O modo remoto usa node para ler a DATABASE_URL, e ele não está disponível." >&2; exit 1; }
}

echo "Criando dump consistente do MySQL (modo $MODO)..."
# O status do dump sai por arquivo porque em pipeline o `sh` só devolve o do
# último comando — o `gzip`. Sem isso, um dump que falhou (senha errada, banco
# inalcançável, MySQL ocupado) gerava um .gz de 20 bytes e o script anunciava
# sucesso. O erro só apareceria no dia da restauração.
status_dump="$BACKUP_ROOT/.status-dump.$$"
(
  if [ "$MODO" = "remoto" ]; then dump_remoto; else dump_compose; fi
  echo $? > "$status_dump"
) | gzip -9 > "$TARGET/database.sql.gz"
codigo_dump=$(cat "$status_dump" 2>/dev/null || echo 1)
rm -f "$status_dump"
if [ "$codigo_dump" != "0" ]; then
  if [ "$BACKUP_REQUIRE_TLS" = "true" ] && [ "$MODO" = "remoto" ]; then
    echo "  Se a falha foi de TLS, o banco pode não aceitar conexão cifrada." >&2
    echo "  Nesse caso rode com BACKUP_REQUIRE_TLS=false — sabendo que o dump" >&2
    echo "  passa a atravessar a rede em texto claro." >&2
  fi
  abortar "O mysqldump falhou (código $codigo_dump). Backup NÃO foi gerado."
fi

# O mysqldump termina com "-- Dump completed on ...". A ausência da linha revela
# truncamento — disco cheio no meio da escrita, conexão cortada — que o código de
# saída não pega.
if ! gzip -dc "$TARGET/database.sql.gz" | tail -5 | grep -q "Dump completed"; then
  abortar "O dump terminou truncado: falta a marca final do mysqldump."
fi

# ---------------------------------------------------------------------------
# Arquivos enviados
# ---------------------------------------------------------------------------
#
# Só entram quando este script roda onde o disco está. Dumpando um banco remoto
# de outra máquina, o disco da API não é alcançável — e um `files.tar.gz` vazio
# seria pior que a ausência dele, porque pareceria cobertura.
if [ -d "$DATA_ROOT/uploads" ] || [ -d "$DATA_ROOT/private_uploads" ]; then
  echo "Copiando arquivos públicos e privados..."
  mkdir -p "$DATA_ROOT/uploads" "$DATA_ROOT/private_uploads"
  tar -C "$DATA_ROOT" -czf "$TARGET/files.tar.gz" uploads private_uploads
  arquivos="sim"
else
  echo "Sem acesso a $DATA_ROOT: este backup cobre o banco, não os arquivos enviados."
  echo "  Imagem de produto e documento vivem no disco de quem serve a API."
  echo "  Confirme o snapshot de disco no painel do provedor."
  arquivos="nao"
fi

cat > "$TARGET/manifest.txt" <<EOF
created_at=$STAMP
database=$MYSQL_DATABASE_NAME
modo=$MODO
arquivos=$arquivos
hostname=$(hostname)
EOF
(cd "$TARGET" && sha256sum ./* > SHA256SUMS)

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
echo "Backup local concluído em $TARGET"

# ---------------------------------------------------------------------------
# Cópia fora da máquina
# ---------------------------------------------------------------------------
#
# Backup que mora no mesmo disco do banco não é backup: disco morto, incêndio ou
# conta do provedor encerrada levam o dado e a cópia juntos. Em modo remoto o
# risco é menor por construção — a cópia já está longe do banco — mas continua
# valendo ter mais de um lugar.
#
# `BACKUP_REMOTE` é um remoto do rclone (prefira um do tipo `crypt`, que cifra
# antes de sair da máquina); `BACKUP_RSYNC_TARGET` é outra máquina por SSH.
if [ -z "$BACKUP_REMOTE" ] && [ -z "$BACKUP_RSYNC_TARGET" ]; then
  # Sem destino externo há dois casos, e eles não podem terminar igual.
  #
  # Quem nunca configurou precisa ser incomodado: o código 2 faz o agendamento
  # reclamar em vez de a ausência da cópia passar meses sem ninguém notar.
  #
  # Quem decidiu ficar só com a cópia local precisa dizer isso em voz alta
  # (BACKUP_ALLOW_LOCAL_ONLY=true). Sem essa saída explícita, a alternativa real
  # é comentar a checagem ou conviver com um alerta vermelho — e conviver com
  # alerta vermelho de backup é o pior hábito possível, porque treina a pessoa a
  # ignorar exatamente o aviso que um dia vai importar.
  if [ "$BACKUP_ALLOW_LOCAL_ONLY" = "true" ]; then
    echo ""
    echo "Cópia única, aceita por BACKUP_ALLOW_LOCAL_ONLY=true: $BACKUP_ROOT."
    if [ "$MODO" = "compose" ]; then
      echo "  Ela está no mesmo disco do banco — perder a máquina perde os dois."
    fi
    echo "  Lembre que documento fiscal autorizado tem guarda obrigatória de cinco anos."
  else
    echo "" >&2
    echo "ATENÇÃO: nenhuma cópia externa configurada." >&2
    echo "  Este backup existe apenas em $BACKUP_ROOT." >&2
    echo "  Configure BACKUP_REMOTE (rclone) ou BACKUP_RSYNC_TARGET (ssh)," >&2
    echo "  ou aceite o risco explicitamente com BACKUP_ALLOW_LOCAL_ONLY=true." >&2
    registrar_marca
    exit 2
  fi
fi

# Falha no envio não apaga o que já foi gerado: a cópia local continua válida, e
# o código de saída diferente de zero é o que faz o agendamento reclamar.
if [ -n "$BACKUP_REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || { echo "rclone não encontrado, mas BACKUP_REMOTE está definido." >&2; exit 1; }
  echo "Enviando para $BACKUP_REMOTE/$STAMP..."
  rclone copy --checksum "$TARGET" "$BACKUP_REMOTE/$STAMP"
  # Conferir depois de enviar: cópia truncada por queda de rede é silenciosa.
  rclone check --checksum "$TARGET" "$BACKUP_REMOTE/$STAMP"
  externo="sim"
  echo "Cópia externa verificada em $BACKUP_REMOTE/$STAMP"
fi

if [ -n "$BACKUP_RSYNC_TARGET" ]; then
  command -v rsync >/dev/null 2>&1 || { echo "rsync não encontrado, mas BACKUP_RSYNC_TARGET está definido." >&2; exit 1; }
  echo "Enviando para $BACKUP_RSYNC_TARGET/$STAMP..."
  # `--mkpath` cria o caminho no destino. Sem ele o rsync só cria o último
  # componente, e um destino ainda vazio falhava com "No such file or directory"
  # que não diz o que fazer. Nem toda versão tem a opção (chegou na 3.2.3), então
  # a presença é conferida em vez de assumida.
  mkpath=""
  rsync --help 2>&1 | grep -q -- "--mkpath" && mkpath="--mkpath"
  if ! rsync -a --checksum $mkpath "$TARGET/" "$BACKUP_RSYNC_TARGET/$STAMP/"; then
    echo "O rsync não conseguiu escrever em $BACKUP_RSYNC_TARGET/$STAMP." >&2
    [ -n "$mkpath" ] || echo "  Esta versão do rsync não tem --mkpath: crie o diretório de destino antes." >&2
    exit 1
  fi
  externo="sim"
  echo "Cópia externa enviada para $BACKUP_RSYNC_TARGET/$STAMP"
fi

registrar_marca
echo "Backup concluído."
