#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

. "$PROJECT_DIR/infra/read-env.sh"
file_domain=$(read_env_value DOMAIN "$ENV_FILE")
DOMAIN=${DOMAIN:-$file_domain}
if [ -z "$DOMAIN" ]; then
  echo "DOMAIN não foi configurado em $ENV_FILE" >&2
  exit 1
fi

# O limite de requisições é contado na memória de cada processo da API. Mais de
# um container multiplicaria o limite sem nenhum sintoma visível, então aqui a
# verificação é sobre o que está rodando de verdade, não sobre o que foi
# declarado no ambiente.
api_replicas=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --status running --format '{{.Service}}' \
  | grep -c '^api$' || true)
if [ "$api_replicas" -gt 1 ]; then
  echo "Há $api_replicas réplicas da API rodando. O limite de requisições é por processo e" >&2
  echo "seria multiplicado por $api_replicas. Volte para uma réplica ou implemente" >&2
  echo "armazenamento compartilhado no ThrottlerModule." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# O backup está de fato rodando?
# ---------------------------------------------------------------------------
#
# A linha de cron está documentada, mas documentação não é crontab. Um
# agendamento que nunca foi instalado — ou que quebrou meses atrás — não dá
# nenhum sintoma até o dia em que o backup é necessário. Aqui a verificação é
# sobre o arquivo que o último envio externo deixou, não sobre a intenção.
file_backup_root=$(read_env_value BACKUP_ROOT "$ENV_FILE")
BACKUP_ROOT=${BACKUP_ROOT:-${file_backup_root:-/srv/chegowia/backups}}
marca="$BACKUP_ROOT/ULTIMO_ENVIO_EXTERNO"
if [ ! -f "$marca" ]; then
  echo "Nenhum backup foi enviado para fora do servidor ainda ($marca não existe)." >&2
  echo "  Rode 'sh infra/backup.sh' e confira o agendamento no crontab." >&2
  exit 1
fi
if [ -n "$(find "$marca" -mtime +2 2>/dev/null)" ]; then
  echo "O último backup externo tem mais de 48 horas (veja $marca)." >&2
  echo "  O agendamento provavelmente parou de rodar." >&2
  exit 1
fi
echo "Último backup externo: $(cat "$marca")"

curl --fail --silent --show-error "https://$DOMAIN/api/health/live" >/dev/null
curl --fail --silent --show-error "https://$DOMAIN/api/health/ready" >/dev/null
curl --fail --silent --show-error "https://$DOMAIN/" >/dev/null

echo "Web, API e banco respondendo em HTTPS."
