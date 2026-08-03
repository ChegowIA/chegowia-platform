FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
COPY . .
RUN npm run build --workspace packages/shared \
  && npm run build --workspace apps/web

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp --home-dir /app nodeapp
COPY --from=builder --chown=nodeapp:nodeapp /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nodeapp:nodeapp /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nodeapp:nodeapp /app/apps/web/public ./apps/web/public
USER nodeapp
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
