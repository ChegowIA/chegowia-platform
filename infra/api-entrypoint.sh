#!/bin/sh
set -eu

# O scanner é obrigatório em produção. Ele roda em modo one-shot (`clamscan`)
# para não manter outro daemon pesado no mesmo serviço. As assinaturas ficam
# em /data/clamav, que pode ser persistido por um disco do provedor.
#
# O container começa como root somente para atualizar a base do antivírus;
# antes de tocar no banco ou executar a API, relança este script como nodeapp.
if [ "$(id -u)" = "0" ]; then
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
echo "Aplicando migrações pendentes..."
./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma

echo "Iniciando o processo (APP_ROLE=${APP_ROLE:-all})..."
exec "$@"
