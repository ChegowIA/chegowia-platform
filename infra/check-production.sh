#!/bin/sh
set -eu

# ---------------------------------------------------------------------------
# Verificação da produção
# ---------------------------------------------------------------------------
#
# Roda em duas situações diferentes, e o que pode ser verificado muda:
#
# No host do `compose.production.yml`, dá para olhar os containers de dentro.
#
# Numa plataforma gerenciada (hoje: API no Render, MySQL no Railway), não existe
# host nem docker — sobra o que se vê de fora: o domínio respondendo e o registro
# do último backup. Exigir docker aqui fazia o script recusar rodar justamente
# onde a produção está.

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$PROJECT_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$PROJECT_DIR/compose.production.yml"}

if [ -f "$ENV_FILE" ]; then
  . "$PROJECT_DIR/infra/read-env.sh"
  ler() { read_env_value "$1" "$ENV_FILE"; }
else
  ler() { :; }
fi

DOMAIN=${DOMAIN:-$(ler DOMAIN)}
# Web e API podem estar em hosts diferentes — hoje a web na Vercel e a API no
# Render. O script assumia as duas atrás do mesmo domínio, que é o desenho do
# Caddy no compose, e por isso batia em 404 no lugar certo do host errado.
WEB_URL=${WEB_URL:-$(ler WEB_URL)}
API_URL=${API_URL:-$(ler API_URL)}
BACKUP_ROOT=${BACKUP_ROOT:-$(ler BACKUP_ROOT)}
BACKUP_ROOT=${BACKUP_ROOT:-$PROJECT_DIR/backups}

# ---------------------------------------------------------------------------
# Containers, quando existirem
# ---------------------------------------------------------------------------

if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

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
else
  echo "Sem docker ou sem $COMPOSE_FILE: verificando apenas o que se vê de fora."
  echo "  Em plataforma gerenciada, o número de instâncias e o papel de cada"
  echo "  serviço (APP_ROLE) se conferem no painel do provedor."
fi

# ---------------------------------------------------------------------------
# O backup está de fato rodando?
# ---------------------------------------------------------------------------
#
# A linha de agendamento está documentada, mas documentação não é crontab. Um
# agendamento que nunca foi instalado — ou que quebrou meses atrás — não dá
# nenhum sintoma até o dia em que o backup é necessário. Aqui a verificação é
# sobre o arquivo que o último backup deixou, não sobre a intenção.
marca="$BACKUP_ROOT/ULTIMO_BACKUP"
if [ ! -f "$marca" ]; then
  echo "Nenhum backup foi registrado ainda ($marca não existe)." >&2
  echo "  Rode 'sh infra/backup.sh' e confira o agendamento." >&2
  exit 1
fi
if [ -n "$(find "$marca" -mtime +2 2>/dev/null)" ]; then
  echo "O último backup tem mais de 48 horas (veja $marca)." >&2
  echo "  O agendamento provavelmente parou de rodar." >&2
  exit 1
fi
backup_stamp=$(sed -n 's/^stamp=//p' "$marca")
backup_externo=$(sed -n 's/^externo=//p' "$marca")
if [ "$backup_externo" = "sim" ]; then
  echo "Último backup: $backup_stamp (com cópia em outro lugar)"
else
  # Aviso, e não falha: ficar com uma cópia só é uma decisão possível, e
  # transformá-la em erro diário treinaria a pessoa a ignorar o alerta. Mas o
  # risco continua sendo dito em voz alta a cada verificação.
  echo "Último backup: $backup_stamp — CÓPIA ÚNICA em $BACKUP_ROOT."
  echo "  Perder esse disco perde a única cópia."
fi

# ---------------------------------------------------------------------------
# O que se vê de fora
# ---------------------------------------------------------------------------

# Sem endereço explícito, cai no desenho do compose: um domínio servindo os dois.
[ -n "$WEB_URL" ] || WEB_URL=${DOMAIN:+https://$DOMAIN}
[ -n "$API_URL" ] || API_URL=${DOMAIN:+https://$DOMAIN/api}

if [ -z "$WEB_URL" ] && [ -z "$API_URL" ]; then
  echo "Nenhum endereço para verificar." >&2
  echo "  Defina WEB_URL e API_URL (hosts separados) ou DOMAIN (um host só)." >&2
  exit 1
fi

if [ -n "$API_URL" ]; then
  curl --fail --silent --show-error "${API_URL%/}/health/live" >/dev/null
  curl --fail --silent --show-error "${API_URL%/}/health/ready" >/dev/null
  echo "API respondendo em ${API_URL%/} (e o banco por trás dela)."
fi

if [ -n "$WEB_URL" ]; then
  curl --fail --silent --show-error "${WEB_URL%/}/" >/dev/null
  echo "Web respondendo em ${WEB_URL%/}."
fi
