FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
COPY . .
RUN npm run prisma:generate --workspace apps/api \
  && npm run build --workspace packages/shared \
  && npm run build --workspace apps/api

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  # `clamdscan` é apenas um cliente: sem o daemon ele nunca analisa um
  # arquivo. Usamos o scanner local `clamscan` e o atualizador `freshclam`.
  && apt-get install -y --no-install-recommends ca-certificates clamav clamav-freshclam openssl tini \
  # As assinaturas sobrevivem quando /data estiver em um disco persistente do
  # provedor. Remover NotifyClamd evita tentar recarregar um daemon que não é
  # usado por este container (as análises são one-shot via clamscan).
  && sed -i 's|^DatabaseDirectory .*|DatabaseDirectory /data/clamav|' /etc/clamav/freshclam.conf \
  && sed -i '/^NotifyClamd /d' /etc/clamav/freshclam.conf \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp --home-dir /app nodeapp
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY packages/shared/package.json ./packages/shared/package.json
COPY infra/api-entrypoint.sh /usr/local/bin/chegowia-api-entrypoint
RUN chmod 0555 /usr/local/bin/chegowia-api-entrypoint \
  && mkdir -p /data/uploads /data/private_uploads /data/clamav \
  && chown -R nodeapp:nodeapp /data/uploads /data/private_uploads \
  && chown -R clamav:clamav /data/clamav \
  && chmod 0755 /data/clamav
# O entrypoint atualiza as assinaturas como root e reduz privilégios antes de
# migrar ou iniciar o Nest. O processo HTTP nunca executa como root.
USER root
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/chegowia-api-entrypoint"]
CMD ["node", "apps/api/dist/src/main.js"]
