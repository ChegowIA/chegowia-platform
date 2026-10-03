#!/bin/sh
set -eu

# O scanner é obrigatório em produção. Ele roda em modo one-shot (`clamscan`)
# para não manter outro daemon pesado no mesmo serviço. As assinaturas ficam
# em /data/clamav, que pode ser persistido por um disco do provedor.
#
# O container começa como root somente para atualizar a base do antivírus;
# antes de tocar no banco ou executar a API, relança este script como nodeapp.
if [ "$(id -u)" = "0" ]; then
  # Um disco persistente montado em /data sobrepõe as pastas criadas durante o
  # build. Inicializá-las no boot torna a primeira montagem segura e
  # idempotente, sem dar acesso do processo HTTP às assinaturas do antivírus.
  mkdir -p /data/uploads /data/private_uploads /data/clamav
  chown -R nodeapp:nodeapp /data/uploads /data/private_uploads
  chown -R clamav:clamav /data/clamav
  chmod 0755 /data/clamav

  if [ "${CLAMAV_SCAN_ENABLED:-false}" = "true" ]; then
    echo "Atualizando assinaturas do ClamAV..."
    freshclam --stdout --no-warnings
  fi
  exec setpriv --reuid=nodeapp --regid=nodeapp --init-groups "$0" "$@"
fi

# A mesma imagem sobe como `api` e como `worker`, então os dois containers
# chegam aqui ao mesmo tempo. O `migrate deploy` do Prisma toma um advisory lock
# no banco antes de aplicar, e é idempotente: quem perder a corrida espera e
# depois não encontra nada pendente. Rodar nos dois garante que nenhum processo
# suba contra um schema antigo.
if [ "${SKIP_PRISMA_MIGRATIONS:-false}" = "true" ]; then
  # Válvula de recuperação operacional: só deve ser habilitada de forma
  # temporária quando uma migration já marcada como falha precisa ser
  # diagnosticada no banco de produção. Não é o comportamento padrão e não
  # tenta "resolver" migrations automaticamente, pois isso poderia esconder
  # uma alteração parcial de schema.
  echo "Migrações Prisma ignoradas temporariamente (SKIP_PRISMA_MIGRATIONS=true)."
else
  echo "Aplicando migrações pendentes..."
  if ./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma; then
    :
  else
    # Uma única migration de CEP chegou parcialmente à produção antes de a
    # alteração de schema ser corrigida. Como o Shell do provedor só fica
    # disponível com o serviço saudável, tratamos APENAS esse estado conhecido
    # no boot. O script recusa qualquer outra migration falha e não remove nem
    # sobrescreve dados de clientes.
    echo "Tentando recuperar exclusivamente a migration de CEP interrompida..."
    node apps/api/prisma/repair-failed-operational-postal-codes.js --allow-production
    echo "Marcando a migration recuperada como aplicada..."
    ./node_modules/.bin/prisma migrate resolve \
      --applied 20261003070000_add_operational_postal_codes \
      --schema=apps/api/prisma/schema.prisma
    echo "Validando migrations após a recuperação..."
    ./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma
  fi
fi

echo "Iniciando o processo (APP_ROLE=${APP_ROLE:-all})..."
exec "$@"
