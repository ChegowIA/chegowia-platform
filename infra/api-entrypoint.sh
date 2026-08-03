#!/bin/sh
set -eu

# A mesma imagem sobe como `api` e como `worker`, então os dois containers
# chegam aqui ao mesmo tempo. O `migrate deploy` do Prisma toma um advisory lock
# no banco antes de aplicar, e é idempotente: quem perder a corrida espera e
# depois não encontra nada pendente. Rodar nos dois garante que nenhum processo
# suba contra um schema antigo.
echo "Aplicando migrações pendentes..."
./node_modules/.bin/prisma migrate deploy --schema=apps/api/prisma/schema.prisma

echo "Iniciando o processo (APP_ROLE=${APP_ROLE:-all})..."
exec "$@"
