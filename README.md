# ChegowIA

Plataforma SaaS multiempresa de gestão de pedidos/delivery, inspirada em sistemas como
Anota AI, com foco em agente virtual de IA, gestão operacional e isolamento multiempresa.

## Stack e decisões de arquitetura

| Camada | Escolha | Por quê |
|---|---|---|
| Front-end | Next.js 14 (App Router) + TypeScript + Tailwind | SSR/CSR híbrido, roteamento por pastas casa bem com as 3 áreas (pública, painel, super admin) |
| Back-end | NestJS + TypeScript | Módulos isolados por domínio, guards/interceptors nativos para RBAC e multiempresa |
| Banco | MySQL 8 (Docker) | Pedido explícito do escopo |
| ORM | **Prisma** (não TypeORM) | Schema único como fonte da verdade, migrations declarativas, client 100% tipado, e permite um **Prisma Client Extension** que injeta `companyId` automaticamente nas queries — mecanismo central do isolamento multiempresa (ver `apps/api/src/common/prisma/prisma-client.factory.ts`) |
| Autenticação | JWT access (15min) + refresh token (7 dias, httpOnly cookie, hash persistido e rotacionado) | Revogável, sem depender de sessão em memória |
| Tempo real | WebSocket (socket.io) por sala de empresa | Pedidos/entregas aparecem no painel sem recarregar |
| IA | Camada abstrata (`AIProvider`) + `DeepSeekProvider` | Troca de modelo (OpenAI/Claude/Gemini) é só implementar a interface, sem tocar no resto |

Monorepo com **npm workspaces**: `apps/api`, `apps/web`, `packages/shared` (enums/tipos
compartilhados entre front e back).

## IA "full" da plataforma

Dois arquivos na raiz do repo são lidos pelo `PromptBuilder` (`apps/api/src/ai`) e
injetados no system prompt de **todo** agente, de qualquer empresa:

- **`regras.md`** — regras de negócio/conduta fixas (perfis, fluxo de pedido,
  isolamento multiempresa, regras da própria IA). Editar aqui muda o comportamento de
  todos os agentes sem tocar em código.
- **`agentes.md`** — define os papéis de agente (`OPERACIONAL`, `ATENDIMENTO`,
  `ONBOARDING`), com objetivo, tom e ferramentas permitidas de cada um.

O treinamento específico de cada empresa fica em `CompanySettings.aiKnowledgeBase`
(editável pelo ADMIN em Configurações) e é sempre reinjetado no prompt.

O agente nunca tem acesso livre ao banco — só chama ferramentas controladas
(`apps/api/src/ai/tools/tools.service.ts`): `getTodayOrders`, `getDelayedOrders`,
`getTopProducts`, `getPendingDeliveries`, `getInactiveCustomers`,
`createPromotionDraft` (sempre cria rascunho `PENDENTE_CONFIRMACAO`, nunca ativa
sozinho) e `generateProductDescription`.

## Isolamento multiempresa

Defesa em duas camadas:
1. Todo service filtra explicitamente por empresa quando aplicável.
2. Um Prisma Client Extension (`apps/api/src/common/prisma/prisma-client.factory.ts`)
   injeta `companyId` automaticamente nas queries de todos os models operacionais,
   usando o contexto da requisição (`AsyncLocalStorage`, ver `common/tenant`). Rotas
   públicas/SUPER_ADMIN sem empresa selecionada ficam em modo `bypass` e devem
   resolver o `companyId` explicitamente (ex.: pelo slug da loja).

## Estrutura

```
chegowia/
  regras.md / agentes.md      # ver seção "IA full" acima
  docker-compose.yml           # MySQL + Adminer
  packages/shared/              # enums e tipos compartilhados
  apps/api/                     # NestJS
    prisma/schema.prisma
    prisma/seed.ts
    src/{auth,users,companies,employees,customers,catalog,orders,
         deliveries,payments,reports,ai,messaging,permissions,realtime,common}
  apps/web/                     # Next.js
    src/app/{ (público em /, /loja, /carrinho, /checkout, /pedido, /minha-conta,
               /login, /cadastro), painel/**, super-admin/** }
    src/lib/ (api-client, auth-store, cart-store, socket-client)
    src/components/ui/
```

## Rodando localmente

```bash
cp .env.example .env
cp .env.example apps/api/.env   # o Prisma CLI lê .env a partir de apps/api

npm install

docker compose up -d            # MySQL + Adminer (http://localhost:8080)

npm run prisma:migrate          # cria as tabelas
npm run prisma:seed             # popula super admin + empresa exemplo + produtos

npm run dev:api                 # http://localhost:3001/api (Swagger em /api/docs)
npm run dev:web                 # http://localhost:3000
```

### Usuários criados pelo seed

| Papel | E-mail | Senha |
|---|---|---|
| SUPER_ADMIN | superadmin@chegowia.com | SuperAdmin@123 |
| ADMIN (empresa "Burger do Thiago") | admin@burgerdothiago.com | Admin@123 |
| CLIENTE | cliente@exemplo.com | Cliente@123 |

## O que está implementado

- Autenticação JWT + refresh, RBAC por `Role` + permissões granulares por
  `FUNCIONARIO`/`COZINHA`/`MOTOBOY`.
- Multiempresa completo: super admin cria empresa → cria ADMIN → ADMIN gerencia
  cardápio, funcionários, pedidos, entregas, clientes, relatórios e configurações.
- Loja pública (`/loja/[slug]`), carrinho, checkout, acompanhamento de pedido em
  tempo real, histórico e repetição de pedido.
- Fluxo de pedido completo (RECEBIDO → ... → ENTREGUE/CANCELADO) com histórico,
  atribuição de motoboy e atualização de status de entrega.
- Agente de IA (DeepSeek) com ferramentas controladas, histórico de conversa e
  fluxo de confirmação para ações sensíveis.
- WhatsApp Fase 1 (link `wa.me` com resumo do pedido, sem API oficial/sem custo).
- Relatórios por empresa e globais (super admin).
- WebSocket para pedidos/entregas em tempo real no painel (o gateway coloca cada
  socket na sala da própria empresa). No acompanhamento de pedido do **cliente**
  (`/pedido/[id]`) não existe sala por cliente, então essa tela usa polling a cada
  10s como mecanismo confiável de atualização, em vez de depender do socket.

## Fora do escopo desta entrega / próximos passos

- WhatsApp Fase 2 (API oficial via webhook) — a tabela `MessagingChannel` e a
  interface `MessagingProvider` já estão prontas para isso.
- Pagamento automático (Mercado Pago/Stripe/Pix) — hoje é só registro manual
  (dinheiro, cartão na entrega, Pix manual); `PaymentProvider` é o ponto de extensão.
- Rastreamento por geolocalização do motoboy.
- Testes automatizados (estrutura do Nest já suporta Jest, mas não foram escritos).

## O que você precisa fornecer para rodar 100%

- **`DEEPSEEK_API_KEY`** (`.env` na raiz e em `apps/api/.env`) — sem isso o agente de
  IA responde com erro 503 ao tentar conversar; o resto do sistema funciona normal.
- Trocar `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` por valores fortes antes de
  qualquer uso além de desenvolvimento local.
- Permissão para rodar Docker sem sudo (`sudo usermod -aG docker $USER && newgrp
  docker`) ou rodar o `docker compose` você mesmo — o ambiente onde este projeto foi
  gerado não tinha o usuário no grupo `docker`.
- Número de WhatsApp de cada empresa (configurável em Configurações → WhatsApp) para
  os links `wa.me` funcionarem de verdade.
