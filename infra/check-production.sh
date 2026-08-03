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

curl --fail --silent --show-error "https://$DOMAIN/api/health/live" >/dev/null
curl --fail --silent --show-error "https://$DOMAIN/api/health/ready" >/dev/null
curl --fail --silent --show-error "https://$DOMAIN/" >/dev/null

echo "Web, API e banco respondendo em HTTPS."
