# ChegowIA

> Para publicação, segurança, Stripe, armazenamento local e backups, siga o
> [guia de produção](docs/PRODUCAO.md).

Plataforma SaaS multiempresa de gestão de pedidos/delivery, inspirada em sistemas como
Anota AI, com foco em agente virtual de IA, gestão operacional e isolamento multiempresa.

## Stack e decisões de arquitetura

| Camada | Escolha | Por quê |
|---|---|---|
| Front-end | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind | SSR/CSR híbrido, roteamento por pastas casa bem com as cinco áreas (pública, cliente, painel, super admin e revendedor) |
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

Cada papel operacional tem o seu assistente, com contexto restrito ao próprio
trabalho: **admin/funcionário** (painel completo), **cozinha** (fila de produção),
**garçom** (mesas e rodadas dele), **motoboy** (entregas dele) e **cliente** (loja
pública). As conversas privadas de papel não aparecem na listagem do administrador —
são ferramenta de trabalho, não janela de supervisão.

Todo consumo de IA de qualquer funcionário é cobrado da **empresa**, não da pessoa: o
`companyId` vem sempre da conversa persistida ou do canal, nunca de dado enviado pelo
cliente. Um teste varre o código e falha se alguma chamada de IA nova não registrar
consumo nem se declarar custo da plataforma (`test/usage-attribution.spec.ts`).

O agente nunca tem acesso livre ao banco — só chama ferramentas controladas
(`apps/api/src/ai/tools/tools.service.ts`): `getTodayOrders`, `getDelayedOrders`,
`getTopProducts`, `getPendingDeliveries`, `getInactiveCustomers`,
`createPromotionDraft` (sempre cria rascunho `PENDENTE_CONFIRMACAO`, nunca ativa
sozinho) e `generateProductDescription`.

## Busca do marketplace interpretada por IA

A busca do topo da home não exige o nome exato do produto. O texto passa por
`SearchIntentService` (`apps/api/src/ai/search/search-intent.service.ts`), que usa o
modelo para transformar a frase em filtros — termos relacionados, tipos públicos de
produto e teto de preço — e devolve junto uma explicação em português do que
entendeu. Buscar "sanduíche" alcança lanche, hambúrguer e smash; "algo doce" alcança
sobremesa, açaí e bolo.

A interpretação é **cacheada pelo texto normalizado** (6h, 500 entradas). Termos de
busca se repetem muito entre visitantes, então o custo em tokens fica baixo — e o
cache também impede que o endpoint público seja usado para queimar crédito.

Sem `DEEPSEEK_API_KEY`, ou se o modelo devolver algo inválido, a busca cai numa
expansão determinística por grupos de sinônimos e continua funcionando; a resposta
sinaliza isso em `interpretation.assisted`.

O resultado abre em `/busca?q=...` — URL de verdade, então voltar, recarregar e
compartilhar o link funcionam. A transição do hero e a entrada dos cards são animadas
com GSAP.

A taxonomia de tipos públicos vive em `apps/api/src/catalog/public-product-types.ts` e
é a mesma consumida pela montagem do marketplace e pela interpretação da busca, para
que as duas não divirjam. O painel flutuante de descoberta usa o mesmo motor.

## WhatsApp Business oficial e atendimento híbrido

Em **Configurações → WhatsApp com IA e equipe**, o empresário só clica em
**Conectar meu WhatsApp**, entra na própria conta Meta Business e escolhe ou cadastra
o número. O popup oficial do **Meta Embedded Signup** devolve uma autorização de uso
único ao servidor; ele valida o número, registra a Cloud API quando necessário,
assina os webhooks e guarda as credenciais cifradas. O empresário não procura nem
copia `Phone Number ID`, WABA ID, token ou PIN.

O identificador do número recebido no webhook é único e associado à empresa logada,
então cada mensagem é resolvida para o negócio correto no servidor — o cliente nunca
envia um `companyId` para escolher o tenant.

- No primeiro contato, a pessoa recebe os botões **Atendente virtual** e **Falar com
  humano**.
- A escolha por humano pausa a IA imediatamente naquela conversa; a equipe assume em
  **Painel → Atendimento** e pode reativar a IA quando fizer sentido.
- O token da Meta e o PIN de registro são validados no vínculo, salvos com AES-256-GCM
  e nunca retornam pela API ou pelo painel.
- A IA recebe nome, contato, endereço, entrega, pagamentos, horários e treinamento da
  empresa conectada, além do catálogo permitido pelas ferramentas.
- Cada mensagem, status Meta, troca de modo e resposta da equipe fica no histórico da
  conversa da própria empresa.

Isso exige uma configuração única da plataforma no App Meta: criar uma configuração
**WhatsApp Embedded Signup** em **Facebook Login for Business**, autorizar o domínio
do painel e preencher `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID`,
`META_EMBEDDED_SIGNUP_ENABLED=true`, `API_PUBLIC_URL`, `META_APP_SECRET`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` e uma chave de 32 bytes em
`WHATSAPP_TOKEN_ENCRYPTION_KEY` (por exemplo, `openssl rand -base64 32`). Cadastre
`{API_PUBLIC_URL}/api/messaging/webhooks/meta` no App Meta, use o mesmo verify token
configurado no ambiente e assine o campo `messages`. O guia completo está em
[docs/PRODUCAO.md](docs/PRODUCAO.md#5-whatsapp-cloud-api-meta).

## Mensalidade e custos variáveis

O seed padrão cria o plano **ChegowIA Profissional** por **R$ 159,90/mês**. A fatura
estimada de cada empresa é calculada assim:

`mensalidade = R$ 159,90 (plano base) + uso de IA + uso do WhatsApp`

Cada chamada de IA registra entrada sem cache, entrada com cache e saída; cada mensagem
WhatsApp registra o tipo final informado pela Meta (serviço, utilidade, marketing ou
autenticação). A tabela **Super admin → Planos e billing** define o custo do provedor
por unidade e a margem. A taxa é fotografada no instante do evento, de modo que uma
mudança futura de preço não altera histórico. Os itens são consolidados por métrica e
adicionados à próxima fatura Stripe de forma idempotente.

A **margem da plataforma** é de 200% sobre o custo de IA e 30% sobre o do WhatsApp,
configurável em **Super admin → Planos e billing**. Os percentuais não são simétricos
de propósito: o custo de IA é irrisório em valor absoluto (uma conversa de 3 mil tokens
custa R$ 0,0025, e triplicada segue invisível no boleto), e a margem existe para
absorver oscilação de câmbio e troca de modelo. No WhatsApp o custo já é relevante —
R$ 0,3217 por template de marketing entregue —, e margem alta tornaria disparo em massa
proibitivo para o lojista.

A taxa é **fotografada no instante do evento**: alterar a margem hoje não recalcula o
consumo já registrado. Isso mantém o histórico auditável, mas significa que uma mudança
de preço só aparece no consumo dali para a frente.

As taxas de custo do provedor vigentes em **31/07/2026** são:

| Provedor | Uso | Custo lançado |
| --- | --- | --- |
| DeepSeek V4 Flash | entrada sem cache | R$ 0,710822 / 1M tokens |
| DeepSeek V4 Flash | entrada com cache | R$ 0,014216 / 1M tokens |
| DeepSeek V4 Flash | saída | R$ 1,421644 / 1M tokens |
| Meta WhatsApp Brasil | serviço | grátis |
| Meta WhatsApp Brasil | template de utilidade/autenticação | R$ 0,0350 / entrega |
| Meta WhatsApp Brasil | template de marketing | R$ 0,3217 / entrega |

Os valores do DeepSeek usam USD/BRL PTAX venda de 5,0773; preços Meta variam pelo país
do destinatário e utilidade/autenticação podem cair por faixa de volume. Revise a tabela
administrativa se o câmbio, modelo, mercado ou volume contratado mudar.

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
    src/{auth,users,companies,employees,customers,catalog,orders,deliveries,
         tables,reports,ai,messaging,billing,usage,resellers,permissions,
         realtime,health,common}
  apps/web/                     # Next.js
    src/app/{ (público em /, /acesso, /loja, /carrinho, /checkout, /planos,
               /software, /revenda, /contratar, /termos, /privacidade,
               /recuperar-senha, /redefinir-senha, /verificar-email),
              (cliente em /minha-conta, /pedido),
              painel/**, super-admin/**, revendedor/** }
    src/lib/ (api-client, auth-store, cart-store, socket-client, types,
              use-auth, query-provider, format, ...)
    src/components/{ui,layout,ai,auth,brand,catalog,deliveries,messaging,
                     orders,resellers}
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

### Testes

```bash
npm run verify      # lint + typecheck + testes unitários + audit + build (sem banco)
npm run test:e2e    # ponta a ponta: sobe o AppModule contra o MySQL
```

`verify` não precisa de infraestrutura e é o ciclo rápido. Os e2e ficam fora dele
de propósito: sobem a aplicação inteira contra um schema **separado**
(`<seu_banco>_e2e`), criado e migrado automaticamente. A suíte trunca tabelas
entre os casos e se recusa a rodar se o alvo não terminar em `_e2e`, então o seu
banco de desenvolvimento nunca é tocado.

Na primeira execução, se o usuário do banco não puder criar schema, a mensagem de
erro entrega o `CREATE DATABASE` e o `GRANT` exatos para rodar uma vez.

O que os e2e cobrem e os unitários não conseguem: o **isolamento multiempresa**
mora na extensão do Prisma, justamente o que um mock substitui — foi assim que
`/reports/top-products` passou a devolver os campeões de venda de todas as
empresas. A única dependência substituída é o cálculo de rota, que sairia pela
internet.

## Fiscal e caixa

**NFC-e completa**: cadastro fiscal da empresa, certificado A1 cifrado em repouso
(AES-256-GCM, chave própria), tributação por produto com padrão herdado da empresa,
motor de cálculo em centavos, XML 4.00, assinatura XMLDSig, transmissão à SEFAZ com
TLS mútuo, QR Code, DANFE (HTML 80mm e texto 48 colunas), contingência offline,
cancelamento, carta de correção, inutilização de numeração e tradução das rejeições
para instrução acionável.

A regra que organiza o módulo: **a venda nunca espera a SEFAZ**. Timeout de 8 segundos;
se estourar, a nota é assinada em contingência (`tpEmis 9`), o cupom sai na hora com aviso
e o worker transmite depois.

**Caixa**: abertura com fundo de troco, sangria e suprimento com motivo obrigatório,
fechamento com conferência por método de pagamento e diferença registrada. Um turno por
ponto de venda — balcão e delivery fecham separado, senão a diferença não tem dono.

## O que está implementado

- Autenticação JWT + refresh, verificação de e-mail, recuperação de senha e MFA por
  e-mail para os papéis sensíveis. RBAC por `Role` + permissões granulares por
  `FUNCIONARIO`/`COZINHA`/`MOTOBOY`/`GARCOM`.
- Multiempresa completo: super admin cria empresa → cria ADMIN → ADMIN gerencia
  cardápio, funcionários, pedidos, entregas, clientes, relatórios e configurações.
- Loja pública (`/loja/[slug]`), carrinho, checkout, acompanhamento de pedido em
  tempo real, histórico e repetição de pedido.
- Fluxo de pedido completo (RECEBIDO → ... → ENTREGUE/CANCELADO) com histórico,
  atribuição de motoboy, registro auditável de ocorrências e compartilhamento de
  localização do motoboy, exibida no mapa do acompanhamento do cliente.
- Atendimento de salão: mesas, sessões de atendimento e comandas locais, com papel
  `GARCOM` e assistente de IA próprio (cada garçom só enxerga as mesas que abriu).
- Assinatura da empresa via Stripe: checkout, webhooks idempotentes, bloqueio por
  inadimplência e cobrança do consumo variável de IA e WhatsApp na próxima fatura.
- Programa de revenda: candidatura com análise de IA, código de indicação, pipeline
  de leads, comissão recorrente e repasse por Stripe Connect.
- Agente de IA (DeepSeek) com ferramentas controladas, histórico de conversa e
  fluxo de confirmação para ações sensíveis.
- WhatsApp Cloud API oficial: conexão isolada por empresa, webhook assinado, inbox em
  tempo real, atendimento humano/IA e razão de consumo auditável. Os links `wa.me`
  de pedido continuam disponíveis como atalho complementar.
- Relatórios por empresa e globais (super admin).
- WebSocket para pedidos/entregas em tempo real no painel (o gateway coloca cada
  socket na sala da própria empresa). No acompanhamento de pedido do **cliente**
  (`/pedido/[id]`) não existe sala por cliente, então essa tela usa polling a cada
  10s como mecanismo confiável de atualização, em vez de depender do socket.

## Fora do escopo desta entrega / próximos passos

- **Pagamento online do pedido do consumidor** — o Stripe já cobre a assinatura da
  empresa e o consumo variável, mas o pagamento do pedido em si continua sendo
  registro manual (`DINHEIRO`, `CARTAO_ENTREGA`, `PIX_MANUAL`). Mercado Pago e Pix
  automático seguem como próximos passos.
- **Cobertura de testes** — há 7 suítes em `apps/api/test` cobrindo regras de domínio,
  billing de consumo, segurança de DTO, validação de ambiente, acesso a conversas de
  IA, Embedded Signup e isolamento multiempresa da mensageria. Falta teste end-to-end
  e não há teste automatizado no `apps/web`.
- **Repasse ao revendedor em produção** depende de Stripe Connect aprovado; sem isso o
  saldo fica contábil no painel.

## O que você precisa fornecer para rodar 100%

- **`DEEPSEEK_API_KEY`** (`.env` na raiz e em `apps/api/.env`) — sem isso o agente de
  IA responde com erro 503 ao tentar conversar; o resto do sistema funciona normal.
- Trocar `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` por valores fortes antes de
  qualquer uso além de desenvolvimento local.
- Permissão para rodar Docker sem sudo (`sudo usermod -aG docker $USER && newgrp
  docker`) ou rodar o `docker compose` você mesmo — o ambiente onde este projeto foi
  gerado não tinha o usuário no grupo `docker`.
- Um único App Meta aprovado para WhatsApp Cloud API e Embedded Signup. Depois da
  configuração da plataforma, cada empresário conecta o próprio número pelo botão do
  painel; não é necessário criar token por cliente.
