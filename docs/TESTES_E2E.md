# Testes de ponta a ponta — ChegowIA

Roteiro para validar o sistema inteiro: 32 controllers, ~248 rotas, 8 perfis de
acesso, 4 assistentes de IA, canal de WhatsApp, entregas com rota real, emissão
fiscal e cobrança recorrente.

**Para a IA que vai executar:** rode primeiro a seção 2 (automatizado) — é rápida e
pega regressão de lógica. Os roteiros manuais existem para o que teste automatizado
não alcança: navegação real, permissão de tela por papel, integração com Asaas,
SEFAZ, OSRM e Gupshup, e o que o consumidor enxerga.

**Relate o que aconteceu de verdade.** Um passo que você não conseguiu executar não
é um passo que passou — diga que não executou e por quê. Divergência se registra com
o que apareceu na tela, no log da API e no banco, **sem consertar antes de reportar**.

---

## 0. Índice: onde cada tela é testada

| Tela | Seção |
|---|---|
| `/` · `/busca` · `/loja/[slug]` · `/loja/[slug]/produto/[productId]` | 5.1 |
| `/planos` · `/software` · `/revenda` · `/termos` · `/privacidade` | 5.1 |
| `/login` · `/cadastro` | 4.1, 4.3 |
| `/verificar-email` · `/recuperar-senha` · `/redefinir-senha` | 4.6 |
| `/acesso` · `/acesso/suporte` · `/acesso/suporte/revendedor` | 4.6, 16.16 |
| `/minha-conta` · `/minha-conta/enderecos` · `/minha-conta/pedidos` | 4.5, 5.2, 5.3 |
| `/carrinho` · `/checkout` · `/pedido/[id]` | 5.3, 5.4 |
| `/mesa/[token]` | 5.5 |
| `/contratar/sucesso` | 5.4 |
| `/painel/dashboard` | 6.8 |
| `/painel/pedidos` · `/painel/pedidos/[id]` | 6.1 |
| `/painel/cardapio` | 6.2 |
| `/painel/mesas` | 6.3 |
| `/painel/caixa` | 6.4 |
| `/painel/clientes` · `/painel/configuracoes` | 6.5 |
| `/painel/funcionarios` | 6.6, 7.3 |
| `/painel/relatorios` | 6.7 |
| `/painel/atendimento` | 6.8, 10.2 |
| `/painel/entregas` | 8 |
| `/painel/agente` | 9 |
| `/painel/notas` · `/painel/fiscal` | 13 |
| `/painel/assinatura` | 14 |
| `/revendedor/dashboard` · `/revendedor/clientes` · `/revendedor/leads` | 15 |
| `/revendedor/financeiro` | 15.4, 15.5, 15.6 |
| `/super-admin/dashboard` · `/super-admin/empresas` · `/super-admin/empresas/[id]` · `/super-admin/empresas/nova` | 16 |
| `/super-admin/planos` · `/super-admin/aprovacoes` · `/super-admin/operacao` · `/super-admin/conta` | 16 |
| `/super-admin/relatorios` | 16.8 |
| `/super-admin/revendedores` | 15.1 |
| `/super-admin/atendimento` | 10.4, 10.5, 10.6, 10.7 |
| `/super-admin/suporte` | 11 |

---

## 1. Preparação

### 1.1 Banco descartável

Os testes e2e apagam dados. O harness recusa schema que não termine em `_e2e`, mas o
roteiro manual usa o banco de desenvolvimento — **nunca aponte nada daqui para produção**.

```sh
docker run -d --name chegowia-teste \
  -e MYSQL_ROOT_PASSWORD=teste -e MYSQL_DATABASE=chegowia \
  -p 3399:3306 mysql:8.0
until docker exec chegowia-teste mysqladmin ping -h 127.0.0.1 -uroot -pteste --silent; do sleep 1; done

export DATABASE_URL="mysql://root:teste@127.0.0.1:3399/chegowia"
npm run prisma:migrate --workspace apps/api
npm run prisma:seed --workspace apps/api
```

Ao terminar: `docker rm -f chegowia-teste`.

### 1.2 Variáveis

Mínimo para subir:

```sh
DATABASE_URL="mysql://root:teste@127.0.0.1:3399/chegowia"
JWT_ACCESS_SECRET="segredo-de-teste-com-mais-de-32-caracteres"
APP_URL="http://localhost:3000"
CORS_ORIGIN="http://localhost:3000"
FISCAL_ENCRYPTION_KEY="MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
WHATSAPP_TOKEN_ENCRYPTION_KEY="ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA="
```

Opcionais que ligam áreas inteiras:

| Variável | Liga |
|---|---|
| `ROUTING_BASE_URL` | rota/distância real (OSRM). Sem ela, usa o servidor público |
| `DEEPSEEK_API_KEY` | todos os assistentes de IA |
| `GUPSHUP_ENABLED` + `GUPSHUP_API_KEY` + `GUPSHUP_WEBHOOK_TOKEN` | canal de WhatsApp |
| `BILLING_PROVIDER=ASAAS` + `ASAAS_API_KEY` + `ASAAS_WEBHOOK_TOKEN` | cobrança |
| `METRICS_TOKEN` | `/api/health/metrics` |
| `OPS_ALERT_EMAIL` + SMTP | alertas operacionais |
| `APP_ROLE` | `api` (só HTTP), `worker` (só jobs), vazio = ambos |

`npm run dev:api` (porta 3001, prefixo `/api`) e `npm run dev:web` (porta 3000).

### 1.3 Credenciais do seed

| Perfil | E-mail | Senha |
|---|---|---|
| SUPER_ADMIN | `superadmin@chegowia.com` | `SuperAdmin@123` |
| ADMIN | `admin@burgerdothiago.com` | `Admin@123` |
| CLIENTE | `cliente@exemplo.com` | `Cliente@123` |

As credenciais do super admin vêm de `SEED_SUPER_ADMIN_EMAIL` e
`SEED_SUPER_ADMIN_PASSWORD`; fora de produção o seed usa os valores acima como padrão.

FUNCIONARIO, COZINHA, MOTOBOY, GARCOM e REVENDEDOR **não vêm no seed** — são criados
nos roteiros 6.6 e 15.

> **Limite de tentativas:** repetir login errado dispara HTTP 429 por alguns instantes.
> É o comportamento correto — ao roteirizar, espere antes de tentar de novo em vez de
> tratar como falha.

### 1.4 Dados de referência

- **Empresa:** Burger do Thiago (`burger-do-thiago`), São Paulo/SP
- **Área de entrega:** Moema, São Paulo — R$ 8,90
- **Cardápio:** Smash Clássico R$ 28,90 (Simples +0 / Duplo +12 · Bacon +6 · Ovo +4) ·
  Veggie Grelhado R$ 26,90 · Refrigerante Lata R$ 6,50

---

## 2. Suítes automatizadas

**`verify` não inclui os e2e** — são comandos separados, e o CI roda os dois.

```sh
npm run verify     # lint, dark mode, glifos, typecheck, 669 testes, audit, build
npm run test:e2e   # AppModule inteiro contra MySQL real
```

Portão de vulnerabilidade da imagem, que só existe no CI:

```sh
docker build -f apps/api/Dockerfile -t chegowia-api:teste .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest \
  image --severity CRITICAL --ignore-unfixed --exit-code 1 chegowia-api:teste
```

Recorte: `npm test --workspace apps/api -- <padrão>`.
**Nunca `npx jest` direto** — sem `--runInBand` abre um worker por núcleo e trava a máquina.

---

## 3. Como reportar

Para cada roteiro: **passou / falhou / não executado** (com motivo), o que apareceu na
tela na divergência, linhas do log da API, e o estado no banco quando o roteiro pedir.

---

## 4. Autenticação, sessão e recuperação

17 rotas em `/api/auth`.

### 4.1 Login e sessão

| # | Passo | Esperado |
|---|---|---|
| 4.1.1 | Login com senha certa | Token de acesso + cookie de refresh |
| 4.1.2 | Senha errada 5x | Mensagem genérica, sem dizer se o e-mail existe |
| 4.1.3 | Usuário desativado | Login recusado |
| 4.1.4 | `POST /auth/refresh` com cookie válido | Novo token; o refresh anterior deixa de valer |
| 4.1.5 | Reusar um refresh já usado | Recusado |
| 4.1.6 | `POST /auth/logout` | Sessão encerrada; refresh não funciona mais |
| 4.1.7 | Token expirado numa chamada | 401, e a tela manda para o login |

### 4.2 MFA

| # | Passo | Esperado |
|---|---|---|
| 4.2.1 | Login de papel exigido em `MFA_REQUIRED_ROLES` | Responde pedindo o segundo fator, sem token completo |
| 4.2.2 | `POST /auth/mfa/verify` com código certo | Token completo emitido |
| 4.2.3 | Código errado / expirado | Recusado, sem revelar qual dos dois |

### 4.3 Cadastro e recuperação

| # | Passo | Esperado |
|---|---|---|
| 4.3.1 | `POST /auth/register` | Conta criada; e-mail de verificação enviado |
| 4.3.2 | `verify-email` com token válido | Conta verificada |
| 4.3.3 | `verify-email` com token usado | Recusado |
| 4.3.4 | `resend-verification` | Novo token; o anterior perde a validade |
| 4.3.5 | `forgot-password` com e-mail inexistente | Mesma resposta do e-mail existente (não enumera contas) |
| 4.3.6 | `reset-password` com token válido | Senha trocada; sessões antigas revogadas |
| 4.3.7 | `change-password` logado com senha atual errada | Recusado |

### 4.4 Multi-contexto

Um mesmo e-mail pode ter vínculo com mais de uma empresa/papel.

| # | Passo | Esperado |
|---|---|---|
| 4.4.1 | `GET /auth/contexts` | Lista os contextos disponíveis |
| 4.4.2 | `POST /auth/context` escolhendo outro | Token novo, com `companyId` do escolhido |
| 4.4.3 | Escolher contexto que não é seu | Recusado |
| 4.4.4 | Após trocar, listar pedidos | Só os da empresa do contexto atual |

### 4.5 Conta do usuário e LGPD

Cinco rotas em `/api/users/me`. A exclusão **anonimiza** em vez de apagar: pedido é
documento fiscal com guarda obrigatória de cinco anos.

| # | Passo | Esperado |
|---|---|---|
| 4.5.1 | `PATCH /users/me` alterando nome | Perfil atualizado |
| 4.5.2 | `POST /users/me/avatar` com imagem | Foto aplicada; arquivo acima de 4 MB recusado |
| 4.5.3 | Enviar `.exe` como avatar | Recusado |
| 4.5.4 | `PATCH /users/me/password` com senha atual errada | Recusado |
| 4.5.5 | Trocar a senha com sucesso | Sessões antigas deixam de valer |
| 4.5.6 | `GET /users/me/export` | Devolve os dados do titular: perfil, endereços, pedidos |
| 4.5.7 | `DELETE /users/me` com senha certa | Conta **anonimizada**; login deixa de funcionar |
| 4.5.8 | Após a exclusão, abrir os pedidos no painel da empresa | Pedidos **continuam existindo**, sem os dados pessoais |
| 4.5.9 | `DELETE /users/me` com senha errada | Recusado |
| 4.5.10 | Exportar/excluir a conta de outro usuário | Impossível — a rota opera sempre sobre o token |

### 4.6 Telas de acesso e verificação

| # | Passo | Esperado |
|---|---|---|
| 4.6.1 | `/verificar-email` com token do e-mail | Confirma e leva ao login |
| 4.6.2 | `/recuperar-senha` | Envia o e-mail sem revelar se a conta existe |
| 4.6.3 | `/redefinir-senha` com token válido | Troca a senha |
| 4.6.4 | `/redefinir-senha` com token expirado | Recusa com opção de pedir outro |
| 4.6.5 | `/acesso` e `/acesso/suporte` | Portas do acesso de suporte (ver 16.16) |
| 4.6.6 | `/acesso/suporte/revendedor` | Mesma checagem, para revendedor |

---

## 5. Consumidor

### 5.1 Vitrine e descoberta

| # | Passo | Esperado |
|---|---|---|
| 5.1.1 | `/` sem login | Institucional; catálogo não aparece |
| 5.1.2 | Login cliente, sem endereço salvo | Catálogo continua vazio (`hasLocation` falso) |
| 5.1.3 | Cadastrar endereço em Moema com CEP válido e voltar | Burger do Thiago aparece quando CEP/cidade indicam área atendida |
| 5.1.4 | `/busca` por "smash" | Produto com o nome da loja |
| 5.1.5 | Trocar endereço padrão para outra cidade | A loja **não** aparece (igualdade de cidade) |
| 5.1.6 | `/loja/burger-do-thiago` | Cardápio completo |
| 5.1.7 | `/loja/[slug]/produto/[id]` | Página do produto com variações e adicionais |
| 5.1.8 | `/loja/slug-inexistente` | 404 tratado |
| 5.1.9 | `/planos`, `/software`, `/revenda`, `/termos`, `/privacidade` | Abrem sem login |
| 5.1.10 | `GET /api/catalog/public/sitemap` | Só empresas e produtos ativos |
| 5.1.11 | Logar como `thiagolpssouza@gmail.com`, salvar endereço dentro do raio da demo e abrir catálogo | Só então a `operacao-demo-chegowia` aparece; outro e-mail, CEP/cidade ou rota fora do raio não a vê |

### 5.2 Endereços (`/minha-conta/enderecos`, 4 rotas)

| # | Passo | Esperado |
|---|---|---|
| 5.2.1 | Cadastrar endereço | CEP de 8 dígitos obrigatório; geocodificado (latitude/longitude preenchidos) |
| 5.2.2 | Marcar como padrão | O anterior deixa de ser padrão |
| 5.2.3 | CEP inexistente | Erro tratado, sem quebrar a tela |
| 5.2.4 | Excluir endereço em uso por pedido ativo | Comportamento consistente (bloqueia ou desvincula, mas não perde o pedido) |

### 5.3 Carrinho, checkout e acompanhamento

| # | Passo | Esperado |
|---|---|---|
| 5.3.1 | Smash Duplo + Bacon + Ovo | Item **R$ 50,90** |
| 5.3.2 | Somar Refrigerante | Subtotal R$ 57,40 |
| 5.3.3 | Checkout em Moema | Taxa **R$ 8,90**; total R$ 66,30 |
| 5.3.4 | Endereço fora da área/raio | Recusa explicando, sem criar pedido |
| 5.3.5 | Finalizar com Dinheiro | Pedido `RECEBIDO`; vai para `/pedido/[id]` |
| 5.3.6 | Acompanhar em `/pedido/[id]` | Status muda sozinho quando o painel avança |
| 5.3.7 | `/minha-conta/pedidos` | Histórico do cliente |
| 5.3.8 | Abrir `/pedido/[id]` de outro cliente | Negado |
| 5.3.9 | Loja fechada (fora do horário) | Checkout recusa ou avisa, conforme configuração |

### 5.4 Orçamento, carrinho e repetição

| # | Passo | Esperado |
|---|---|---|
| 5.4.1 | `/carrinho` com itens | Resumo com variações, adicionais e subtotal |
| 5.4.2 | `POST /me/orders/quote` antes de fechar | Devolve taxa e prazo **sem** criar pedido |
| 5.4.3 | Orçamento para endereço fora da área | Informa que não atende, sem criar nada |
| 5.4.4 | `POST /me/orders/:id/repeat` de um pedido antigo | Novo carrinho com os mesmos itens |
| 5.4.5 | Repetir pedido cujo produto foi desativado | Avisa o que saiu do cardápio, sem quebrar |
| 5.4.6 | Repetir pedido de outro cliente | Negado |
| 5.4.7 | `/contratar/sucesso` após contratar | Confirmação com o próximo passo |

### 5.5 Mesa por QR

| # | Passo | Esperado |
|---|---|---|
| 5.5.1 | `/mesa/[token]` de mesa ativa | Cardápio sem exigir login |
| 5.5.2 | Lançar dois itens | `DiningOrder` com `source = QR_MESA`, status `RECEBIDO` |
| 5.5.3 | Token inválido | "QR da mesa não encontrado" |
| 5.5.4 | Mesa `INATIVA` | Mesma recusa |
| 5.5.5 | Empresa inativa | Recusado |

---

## 6. Painel da empresa — ADMIN

### 6.1 Pedidos

Fluxo: `RECEBIDO → CONFIRMADO → EM_PREPARO → PRONTO → SAIU_PARA_ENTREGA → ENTREGUE`.
`CANCELADO` sai de qualquer ponto antes de `ENTREGUE`.

| # | Passo | Esperado |
|---|---|---|
| 6.1.1 | Avançar um a um até `ENTREGUE` | Histórico grava quem mudou cada etapa |
| 6.1.2 | Pular de `RECEBIDO` para `ENTREGUE` | Transição inválida |
| 6.1.3 | Duas abas avançando o mesmo pedido | A segunda recebe conflito |
| 6.1.4 | Cancelar em `EM_PREPARO` | Vai para `CANCELADO` |
| 6.1.5 | Marcar como pago | `paymentStatus = PAGO`; se `autoEmit`, dispara NFC-e |
| 6.1.6 | `/painel/pedidos/[id]` | Itens, endereço, histórico e entrega |

### 6.2 Cardápio (13 rotas de produto)

| # | Passo | Esperado |
|---|---|---|
| 6.2.1 | Criar categoria e produto | Aparece na vitrine |
| 6.2.2 | Desativar produto | Some da vitrine, fica no painel |
| 6.2.3 | Criar variação e adicional | Refletem no preço (6.2 → 5.3.1) |
| 6.2.4 | Excluir variação usada em pedido antigo | Pedido histórico preserva o que foi vendido |
| 6.2.5 | Enviar imagem do produto | Upload aceito; formato/ tamanho inválidos recusados |
| 6.2.6 | Marcar como destaque | Entra na faixa de destaques do marketplace |
| 6.2.7 | Baixar modelo de importação (`import/template`) | Planilha com as colunas esperadas |
| 6.2.8 | Pré-visualizar importação (`import/preview`) | Mostra o que vai entrar **antes** de gravar |
| 6.2.9 | Aplicar importação (`import/:id/apply`) | Produtos criados, com custo quando informado |
| 6.2.10 | Importar planilha com coluna faltando | Erro apontando a coluna |
| 6.2.11 | Criar, renomear e reordenar categorias | Ordem reflete na vitrine |
| 6.2.12 | Desativar categoria com produtos ativos | Produtos somem da vitrine junto |
| 6.2.13 | Excluir categoria em uso | Bloqueado ou com aviso do impacto |
| 6.2.14 | Abrir **Pré-visualizar como cliente** como ADMIN | Abre em outra aba a mesma seleção ativa do cardápio, sem permitir criar pedido |

### 6.3 Mesas e salão

| # | Passo | Esperado |
|---|---|---|
| 6.3.1 | Criar mesa e gerar QR | Token gerado |
| 6.3.2 | Abrir comanda, lançar, marcar `SERVIDO` | Soma só o servido |
| 6.3.3 | Cancelar item lançado | Não entra no total nem na nota |
| 6.3.4 | Fechar com pedido em preparo | "Finalize ou cancele os pedidos ativos" |
| 6.3.5 | Fechar com forma de pagamento | Sessão `FECHADA`, mesa `LIVRE` |
| 6.3.6 | Transferir/juntar mesas (se disponível) | Comanda consolidada sem perder item |
| 6.3.7 | Reabrir mesa fechada | Conforme a regra: bloqueado ou com registro |
| 6.3.8 | `tables/overview` — visão do salão | Todas as mesas com estado e valor aberto |
| 6.3.9 | Garçom A abre comanda; garçom B chama `:id/assume` | B passa a ser o atendente; troca fica registrada |
| 6.3.10 | Rotacionar o QR (`:id/qr/rotate`, só ADMIN) | Token novo; **o QR antigo para de abrir** |
| 6.3.11 | Tentar rotacionar como GARCOM | Negado |

### 6.4 Caixa (9 rotas)

| # | Passo | Esperado |
|---|---|---|
| 6.4.1 | Abrir com valor inicial | Sessão `ABERTA` |
| 6.4.2 | Sangria e suprimento | Movimentos ajustam o esperado |
| 6.4.3 | Fechar com divergência | Diferença registrada, não bloqueada |
| 6.4.4 | Abrir dois caixas no mesmo ponto | O segundo é recusado |
| 6.4.5 | Relatório de fechamento | Bate com pedidos pagos no período |
| 6.4.6 | Criar e editar ponto de venda (`caixa/pontos`) | Ponto disponível para abrir turno |
| 6.4.7 | Desativar ponto com turno aberto | Recusado |
| 6.4.8 | `caixa/turnos/atual` | Devolve o turno aberto do operador, ou vazio |
| 6.4.9 | Listar movimentos do turno (`:id/movimentos`) | Sangrias e suprimentos na ordem |

### 6.5 Clientes e configurações

| # | Passo | Esperado |
|---|---|---|
| 6.5.1 | `/painel/clientes` | Só clientes da própria empresa |
| 6.5.2 | Logo da empresa (`me/logo`) | Upload aplicado na vitrine |
| 6.5.3 | `me/settings` — horário, raio, taxa | Refletem no checkout do consumidor |
| 6.5.4 | Desativar a empresa | Some da vitrine imediatamente |

### 6.6 Funcionários (5 rotas)

| # | Passo | Esperado |
|---|---|---|
| 6.6.1 | Criar um de cada papel (FUNCIONARIO, COZINHA, MOTOBOY, GARCOM) | Nasce com as permissões padrão do papel (7.1) |
| 6.6.2 | Criar com e-mail já usado | Recusado |
| 6.6.3 | Editar permissões (`:id/permissions`) | Só as marcadas passam a valer |
| 6.6.4 | Trocar o papel | Permissões voltam ao padrão do novo papel |
| 6.6.5 | Desativar funcionário logado em outra aba | Próxima chamada dele é recusada |
| 6.6.6 | Reativar | Volta a acessar com as permissões que tinha |

### 6.7 Relatórios da empresa (7 rotas)

Confira que cada número bate com o que foi criado nos roteiros anteriores — relatório
que "abre" mas mostra número errado é o defeito silencioso desta área.

| # | Relatório | O que conferir |
|---|---|---|
| 6.7.1 | Vendas (`sales`) | Soma dos pedidos pagos no período; filtro de data funciona |
| 6.7.2 | Pedidos por situação (`orders-by-status`) | Contagem por status bate com a tela de pedidos |
| 6.7.3 | Produtos mais vendidos (`top-products`) | Ranking reflete os itens dos pedidos criados |
| 6.7.4 | Clientes recorrentes (`recurring-customers`) | Quem pediu mais de uma vez aparece |
| 6.7.5 | Entregas atrasadas (`delayed-deliveries`) | Só o que passou do limiar |
| 6.7.6 | Desempenho de motoboy (`motoboy-performance`) | Entregas por pessoa e tempo médio |
| 6.7.7 | Horários de pico (`peak-hours`) | Distribuição por hora, coerente com os horários dos pedidos |
| 6.7.8 | Empresa sem movimento | Relatório vazio, não erro |
| 6.7.9 | Abrir como FUNCIONARIO sem `relatorios.visualizar` | Negado |

### 6.8 Acompanhamento em tempo real do dia

Rotas que alimentam o dashboard e os contadores da barra lateral.

| # | Passo | Esperado |
|---|---|---|
| 6.8.1 | `orders/today` | Só os pedidos de hoje da empresa |
| 6.8.2 | `orders/pending-count` | Número bate com os pedidos não finalizados |
| 6.8.3 | `orders/delayed` | Lista os parados além do limiar |
| 6.8.4 | `orders/flow` | Devolve o fluxo de status válido, usado pela tela |
| 6.8.5 | Criar pedido com o dashboard aberto | Contadores sobem sem recarregar |
| 6.8.6 | `customers/inactive` | Clientes sem pedido no período |
| 6.8.7 | `/painel/atendimento` | Conversas de WhatsApp da empresa (ver 10.2) |
| 6.8.8 | `/painel/notas` | Notas fiscais emitidas, com filtro por situação |

---

## 7. Perfis e permissões

### 7.1 Matriz padrão

| Papel | Permissões ao nascer |
|---|---|
| **FUNCIONARIO** | caixa (ver, operar), pedidos (ver, editar), mesas (ver, operar), cardápio (ver), entregas (ver) |
| **COZINHA** | pedidos (ver, editar), mesas (ver, operar) |
| **MOTOBOY** | entregas (ver, editar) |
| **GARCOM** | mesas (ver, operar), cardápio (ver) |
| **ADMIN** | tudo da empresa |

### 7.2 O que cada um pode e **não** pode

| # | Papel | Consegue | Deve ser negado |
|---|---|---|---|
| 7.2.1 | FUNCIONARIO | Caixa, pedidos, mesas | `/painel/funcionarios`, `/painel/fiscal`, `/painel/assinatura`, relatórios |
| 7.2.2 | COZINHA | Marcar `EM_PREPARO` e `PRONTO` | `SAIU_PARA_ENTREGA`, `ENTREGUE`, caixa, cardápio |
| 7.2.3 | MOTOBOY | Ver e avançar as **próprias** entregas | Pedidos, mesas, cardápio, caixa, entregas de outro motoboy |
| 7.2.4 | GARCOM | Comanda, lançar item, ver cardápio | Fechar caixa, editar cardápio, relatórios |
| 7.2.5 | CLIENTE | `/minha-conta` e pedidos próprios | Qualquer `/painel/*` |
| 7.2.6 | REVENDEDOR | `/revendedor/*` | `/painel/*` e `/super-admin/*` |

> A restrição da COZINHA é regra de serviço, não só de tela.

### 7.3 Permissão granular

| # | Passo | Esperado |
|---|---|---|
| 7.3.1 | Remover `caixa.operar` de um FUNCIONARIO | Ele vê o caixa mas não movimenta |
| 7.3.2 | Conceder `relatorios.visualizar` a um GARCOM | Passa a abrir relatórios |
| 7.3.3 | Trocar o papel de um funcionário | Permissões voltam ao padrão do novo papel |
| 7.3.4 | Desativar funcionário logado | Próxima chamada é recusada |

### 7.4 Isolamento multiempresa

O teste mais importante e o mais fácil de esquecer — nada na tela sugere que ele exista.

| # | Passo | Esperado |
|---|---|---|
| 7.4.1 | Criar segunda empresa com dados próprios | — |
| 7.4.2 | Na empresa A, listar pedidos | Só os de A |
| 7.4.3 | Na empresa A, abrir por id um pedido de B | Não encontrado |
| 7.4.4 | Repetir com produtos, clientes, mesas, caixa, notas, entregas, conversas | Sempre só a própria |
| 7.4.5 | Chamar a API direto com `x-company-id` de outra empresa | Ignorado para quem não é super admin |

---

## 8. Entregas, motoboy e rotas

### 8.1 Atribuição e fluxo

Fluxo: `AGUARDANDO_RETIRADA → RETIRADO → EM_ROTA → ENTREGUE`, com desvio para `PROBLEMA`.

| # | Passo | Esperado |
|---|---|---|
| 8.1.1 | Atribuir motoboy a pedido `PRONTO` | Entrega em `AGUARDANDO_RETIRADA`; pedido vai a `SAIU_PARA_ENTREGA` |
| 8.1.2 | Atribuir a quem não é MOTOBOY | Recusado |
| 8.1.3 | Reatribuir para outro motoboy | Histórico preserva quem estava antes |
| 8.1.4 | Avançar até `ENTREGUE` | Pedido chega a `ENTREGUE` junto |
| 8.1.5 | Registrar `PROBLEMA` com motivo | Motivo gravado; pedido não avança sozinho |
| 8.1.6 | Voltar de `PROBLEMA` para `EM_ROTA` | Conforme a regra: permitido com registro |

### 8.2 Visão do motoboy

| # | Passo | Esperado |
|---|---|---|
| 8.2.1 | Login MOTOBOY → `/painel/entregas` | Só a fila dele |
| 8.2.2 | `GET /api/deliveries/me` | Apenas entregas atribuídas a ele |
| 8.2.3 | Tentar avançar entrega de outro motoboy | Negado |
| 8.2.4 | Tentar abrir `/painel/pedidos` | Negado |

### 8.3 Localização em tempo real

| # | Passo | Esperado |
|---|---|---|
| 8.3.1 | `PATCH /api/deliveries/:id/location` com lat/long | Posição gravada |
| 8.3.2 | Painel aberto durante o envio | Evento `delivery.updated` chega por websocket e a tela move sem recarregar |
| 8.3.3 | Cliente em `/pedido/[id]` | Vê o avanço da entrega |
| 8.3.4 | Enviar coordenada inválida (lat 999) | Recusado |
| 8.3.5 | Enviar localização de entrega já `ENTREGUE` | Recusado ou ignorado, sem corromper o histórico |

### 8.4 Rotas, mapa e distância (OSRM)

O catálogo pode usar o centro aproximado do CEP para triagem. No checkout do
site, cliente confirma o destino no mapa e a loja precisa ter coordenadas de
origem. A taxa usa a rota de carro por OSRM (`ROUTING_BASE_URL`); o CEP não
substitui o ponto de entrega.

| # | Passo | Esperado |
|---|---|---|
| 8.4.1 | Confirmar pontos de loja e cliente, criar pedido com CEP válido | Distância e tempo da rota preenchidos |
| 8.4.2 | Conferir a taxa | Taxa base + km da rota × taxa por km configurada |
| 8.4.3 | Endereço fora do raio configurado | Recusado no checkout |
| 8.4.4 | Derrubar o OSRM (apontar `ROUTING_BASE_URL` para porta morta) | Checkout recusa a cotação com erro claro; não cobra frete arbitrário |
| 8.4.5 | Endereço que não geocodifica | Busca oferece o centro do CEP apenas como ponto inicial; cliente move o pino e confirma |
| 8.4.6 | Dois pedidos seguidos para o mesmo endereço | A fila de geocodificação não estoura limite do provedor |
| 8.4.7 | Loja e cliente com o mesmo CEP, mas pinos distintos | Rota não zera a distância só por coincidência de CEP |
| 8.4.8 | Editar rua/CEP após confirmar o pino | Confirmação é removida e uma nova cotação só sai após confirmar novamente |
| 8.4.9 | Motoboy abre a rota de pedido novo | Navegação recebe as coordenadas salvas no pedido, não um endereço ambíguo |

### 8.5 Relatório de motoboy

| # | Passo | Esperado |
|---|---|---|
| 8.5.1 | `/painel/relatorios` → desempenho de motoboy | Entregas por pessoa, tempo médio |
| 8.5.2 | Entregas atrasadas | Lista o que passou do limiar |

---

## 9. Assistentes de IA

Quatro assistentes internos e um público. Exigem `DEEPSEEK_API_KEY`; sem ela, marque
como não executado.

| Assistente | Rota | Quem usa |
|---|---|---|
| Painel | `/api/ai/conversations` | ADMIN e equipe |
| Cozinha | `/api/ai/cozinha` | COZINHA |
| Garçom | `/api/ai/garcom` | GARCOM |
| Motoboy | `/api/ai/motoboy` | MOTOBOY |
| Público | `/api/ai/public/:slug` | consumidor, na loja |

### 9.1 Conversa e ferramentas

O assistente do painel tem ferramentas de leitura e de escrita.

| # | Passo | Esperado |
|---|---|---|
| 9.1.1 | "quantos pedidos hoje?" | Responde com o número real do dia |
| 9.1.2 | "tem pedido atrasado?" | Lista os parados além do limiar |
| 9.1.3 | "quais os produtos mais vendidos da semana?" | Ranking real |
| 9.1.4 | "quais entregas estão pendentes?" | Fila atual |
| 9.1.5 | "quais clientes sumiram?" | Inativos há mais de 30 dias |
| 9.1.6 | "gera uma descrição para o Smash" | Texto sugerido, **sem** gravar sozinho |
| 9.1.7 | "cria uma promoção de 20% nas bebidas" | Cria **rascunho** e pede confirmação |
| 9.1.8 | `POST /api/ai/actions/:id/confirm` | A ação é aplicada e registra quem confirmou |
| 9.1.9 | Não confirmar a ação | Nada é aplicado |
| 9.1.10 | Pedir dado de outra empresa | Recusa — as ferramentas são escopadas |

### 9.2 Assistentes por papel

| # | Passo | Esperado |
|---|---|---|
| 9.2.1 | COZINHA pergunta o que está na fila | Responde com pedidos em preparo |
| 9.2.2 | GARCOM pergunta sobre uma mesa | Responde com a comanda |
| 9.2.3 | MOTOBOY pergunta a próxima entrega | Responde com a fila dele |
| 9.2.4 | MOTOBOY tenta usar o assistente do painel | Negado |

### 9.3 Assistente público

| # | Passo | Esperado |
|---|---|---|
| 9.3.1 | Perguntar o cardápio na loja | Responde com produtos ativos daquela loja |
| 9.3.2 | Perguntar de loja `isTestOnly` | Não encontra |
| 9.3.3 | Pedir dado interno (faturamento) | Recusa |

### 9.4 Consumo

| # | Passo | Esperado |
|---|---|---|
| 9.4.1 | Conversar e conferir `/api/usage/company/summary` | Uso de IA registrado |
| 9.4.2 | Conferir na fatura | Consumo entra como variável, **fora** da comissão do revendedor |

---

## 10. WhatsApp (Gupshup)

24 rotas em `/api/messaging`. Exige `GUPSHUP_ENABLED=true`.

### 10.1 Conexão do canal

| # | Passo | Esperado |
|---|---|---|
| 10.1.1 | Solicitar acesso (`channel/whatsapp/request`) | Pedido registrado; evento `whatsapp.access.requested` |
| 10.1.2 | Super admin aprova | Canal liberado para a empresa |
| 10.1.3 | Conectar (`channel/whatsapp/gupshup/connect`) | Credencial gravada **cifrada** |
| 10.1.4 | Consultar status | Estado real do canal |
| 10.1.5 | Atualizar perfil e foto | Refletem no WhatsApp |
| 10.1.6 | Desconectar | Canal removido; token apagado |
| 10.1.7 | Ler a credencial pela API | **Nunca** volta em claro |
| 10.1.8 | Ligar a automação (`channel/whatsapp/automation`) | Respostas automáticas passam a sair |
| 10.1.9 | Desligar a automação | Mensagem fica só na fila de atendimento humano |
| 10.1.10 | Webhook de auto-atendimento (`webhooks/gupshup/self-serve`) | Onboarding do número conclui sozinho |
| 10.1.11 | Super admin gerencia o canal de uma empresa (`messaging/companies/:companyId/whatsapp`) | Consegue conectar/desconectar pela empresa |

### 10.1.1 Permissão de atendimento

O inbox era liberado pelas permissões de pedido: quem via pedido lia todas as
conversas dos clientes, e não havia como dar o inbox a um atendente sem dar
pedidos junto.

| # | Passo | Esperado |
|---|---|---|
| a | Funcionário só com "Ver pedidos" | **Não** vê o menu Atendimento nem a rota de conversas (403) |
| b | Conceder "Ver conversas do WhatsApp" | Vê o menu e lista as conversas, sem poder responder |
| c | Conceder "Responder e apagar conversas" | Passa a responder, limpar, apagar e trocar o modo |
| d | Tirar as duas e manter pedidos | Volta a não ver o Atendimento |
| e | ADMIN sem permissão nenhuma marcada | Continua com acesso: administrador tem acesso irrestrito à própria empresa |

### 10.2 Webhook e conversas

| # | Passo | Esperado |
|---|---|---|
| 10.2.1 | Webhook com token errado | 401 |
| 10.2.2 | Webhook válido com mensagem | Conversa criada; evento `whatsapp.message.received` |
| 10.2.3 | Reenviar o mesmo evento | Não duplica a mensagem |
| 10.2.4 | Responder pelo painel | `whatsapp.message.sent`; chega no aparelho |
| 10.2.5 | Atribuir conversa a um atendente | `whatsapp.conversation.updated` |
| 10.2.6 | Gerar link de pedido (`orders/:orderId/whatsapp-link`) | Link abre a conversa com o texto certo |
| 10.2.7 | "Limpar" no cabeçalho da conversa | Mensagens somem, contato **permanece** na lista, rascunho em aberto é cancelado |
| 10.2.8 | "Apagar" numa conversa sem pedido | Conversa sai da lista; escrever de novo cria uma nova |
| 10.2.9 | "Apagar" numa conversa que gerou pedido | Recusado, dizendo quantos pedidos e indicando "Limpar histórico" |
| 10.2.10 | Apagar sem a permissão de responder | 403 |

### 10.3 Pedido montado por WhatsApp

Rascunho: `MONTANDO → AGUARDANDO_CONFIRMACAO → CONCLUIDO` (ou `CANCELADO`).

| # | Passo | Esperado |
|---|---|---|
| 10.3.1 | Cliente pede itens por mensagem | Rascunho em `MONTANDO` com os itens |
| 10.3.2 | Informar nome, endereço e forma de pagamento | Campos preenchidos no rascunho |
| 10.3.3 | Pedir o resumo | Vai para `AGUARDANDO_CONFIRMACAO` com total e taxa |
| 10.3.4 | Confirmar | Pedido real criado; rascunho `CONCLUIDO`; evento `order.created` |
| 10.3.5 | Desistir no meio | Rascunho `CANCELADO`, sem pedido |
| 10.3.6 | Pedir produto inexistente | Assistente não inventa item |
| 10.3.7 | Endereço fora da área | Avisa antes de fechar |

### 10.4 Canal institucional (`/api/platform/whatsapp`, 23 rotas)

| # | Passo | Esperado |
|---|---|---|
| 10.4.1 | Configurar o canal da plataforma | Independente do canal das empresas |
| 10.4.2 | Receber mensagem | `platform.whatsapp.message.received` |
| 10.4.3 | Responder pelo super admin | `platform.whatsapp.message.sent` |
| 10.4.4 | Conferir isolamento | Mensagem institucional não aparece para nenhuma empresa |
| 10.4.5 | Perfil e foto do canal institucional | Atualizam sem afetar o canal das empresas |
| 10.4.6 | Automação institucional | Liga e desliga de forma independente |
| 10.4.7 | "Limpar" na conversa institucional | Mensagens somem, contato permanece na lista |
| 10.4.8 | "Apagar" na conversa institucional | Conversa sai da lista |
| 10.4.9 | Apagar conversa que veio de um disparo | Some da lista, mas o alvo do disparo continua registrado como abordado |

### 10.5 Conversa iniciada pelo super admin

O WhatsApp só aceita texto livre nas 24h seguintes à **última mensagem da
pessoa**. Fora dessa janela, apenas modelo aprovado pela Meta. Um teste que ignore
isso passa na tela e falha no aparelho: o provedor aceita a requisição, não
entrega nada, e a conversa fica com uma mensagem "enviada" que ninguém recebeu.

| # | Passo | Esperado |
|---|---|---|
| 10.5.1 | Nova conversa com número que nunca escreveu, sem modelo cadastrado | Recusa explicando a janela de 24h; nada é enviado |
| 10.5.2 | Cadastrar o modelo (`PATCH outreach/template`) e repetir | Abertura sai pelo modelo; resposta traz `via: "modelo"` |
| 10.5.3 | Conferir o inbox depois do envio | A mensagem aparece com o texto do modelo já preenchido, não com `{{1}}` |
| 10.5.4 | Nova conversa com número que respondeu há 1 hora | Texto digitado sai como está; resposta traz `via: "texto"` |
| 10.5.5 | Nova conversa com número que respondeu há 30 horas | Volta ao modelo, porque a janela fechou |
| 10.5.6 | Número na lista de não contatar | Recusa nomeando o número; nada é enviado |
| 10.5.7 | Número inválido (DDD inexistente, 9 dígitos sem DDD) | 400 antes de chegar ao provedor |
| 10.5.8 | Conversa criada à mão | Nasce em modo humano: a IA não responde por cima do superadmin |
| 10.5.9 | Responder no inbox uma conversa fora da janela de 24h | 400 explicando a regra; a caixa de texto fica desabilitada com o aviso |
| 10.5.10 | Responder dentro da janela | Envia normalmente |

### 10.6 Prospecção em lista

| # | Passo | Esperado |
|---|---|---|
| 10.6.1 | Colar lista mista e conferir (`POST outreach/analyze`) | Relatório com aptos, repetidos, recusados e descartados; nada é criado |
| 10.6.2 | Linha "Pizzaria do Zé - Goiânia - (62) 99999-8888" | Nome e cidade separados do telefone |
| 10.6.3 | Linha só com o número, coluna colada de planilha | Aceita, sem nome |
| 10.6.4 | Mesmo número em três formatos diferentes | Conta uma vez; `repetidosNaLista` = 2 |
| 10.6.5 | Linha sem telefone e DDD inexistente | Voltam em `recusados` com o trecho original e o motivo |
| 10.6.6 | Telefone fixo na lista | Sinalizado em `possiveisFixos` (fixo quase nunca tem WhatsApp) |
| 10.6.7 | Número que já tem conversa no canal | Descartado: "já existe conversa com este número" |
| 10.6.8 | Número de empresa que já é cliente | Descartado: "número de uma empresa que já é cliente" |
| 10.6.9 | Número já usado em outro disparo | Descartado: "já entrou em outro disparo" |
| 10.6.10 | Número na lista de não contatar | Descartado: "pediu para não receber" |
| 10.6.11 | Criar o disparo | Nasce em `RASCUNHO`; **nenhuma** mensagem sai ainda |
| 10.6.12 | Começar sem modelo aprovado | Recusa antes do primeiro envio |
| 10.6.13 | Começar com modelo | Vira `ENVIANDO`; primeiro envio no próximo giro do worker |
| 10.6.14 | Acompanhar dois envios seguidos | Intervalo entre eles cai na faixa configurada, e varia |
| 10.6.15 | Limite diário alcançado | Fica parado e reagenda para o dia seguinte, sem consultar o banco em laço |
| 10.6.16 | Disparo às 3h | Envia normalmente: não há janela de horário |
| 10.6.17 | Domingo | Envia normalmente |
| 10.6.18 | Formulário do disparo | Não há opção de horário comercial |
| 10.6.19 | Pausar no meio | Para na hora; a fila continua registrada |
| 10.6.20 | Retomar | Segue de onde parou, sem reenviar quem já recebeu |
| 10.6.21 | Cancelar | Pendentes viram `DESCARTADO`; enviados permanecem no relatório |
| 10.6.22 | Fila esvaziada | Vira `CONCLUIDA` sozinho |
| 10.6.23 | Reiniciar o processo da API no meio do disparo | Retoma sem reenviar nem atropelar o intervalo |
| 10.6.24 | Falha no envio | Uma tentativa por contato: marca `FALHOU` com o erro, sem repetir sozinho |
| 10.6.25 | Modelo recusado pela Meta (erro em série) | Pausa automática após 5 falhas sem nenhum envio, com o motivo e o último erro |
| 10.6.26 | Recolar um número que falhou | Aceito: falha não torna o contato inalcançável |
| 10.6.27 | Recolar um número que recebeu de verdade | Descartado: "já existe conversa com este número" |
| 10.6.28 | Conferir o consumo depois de um disparo | Mensagens contam como `WHATSAPP_TEMPLATE_MARKETING` no consumo da plataforma |
| 10.6.29 | Dois disparos ativos ao mesmo tempo | Um envio por giro **no total**, alternando entre eles — não um por disparo |
| 10.6.30 | Teto de 24h do número (`WHATSAPP_OUTREACH_DAILY_CAP`, padrão 250) | Todos os disparos reagendam; nada sai até a janela rolar |
| 10.6.31 | Intervalo pedido abaixo de 10s | Elevado ao piso, que é o giro do worker |
| 10.6.32 | Réplica com `APP_ROLE=api` | Não dispara: só o processo de worker envia |
| 10.6.33 | Banco fora do ar durante um giro | Erro registrado no log; o processo não cai |
| 10.6.34 | Lista de 2 mil números | Criada em menos de 1s; conferência devolve 50 exemplos com o total ao lado |
| 10.6.35 | Apagar campanha cancelada pela lixeira | Some da lista; reimportar um número já enviado continua descartado |
| 10.6.36 | Lixeira em campanha enviando | Não aparece; é preciso pausar ou cancelar antes |

### 10.6.1 Leitura da lista: casos que já falharam

| # | Linha colada | Esperado |
|---|---|---|
| a | `Pizzaria X - CNPJ 12.345.678/0001-90 - (62) 99999-8888` | Lê o telefone. O rabo do CNPJ já engoliu o número real uma vez |
| b | `Ticket médio R$ 1.500,00 - 62 99999-8888` | Lê o telefone |
| c | `Rua 5, 74000-000 - Goiânia - 62 99999-8888` | Lê o telefone; CEP não confunde |
| d | `Pedido 123456789012 - Bar - 62 99999-8888` | Lê o telefone |
| e | `12.345.678/0001-90` sozinho | Recusado: CNPJ não vira telefone |
| f | `62 9999-8888` (8 dígitos) | **Recusado** com "confira se falta o 9". Completar mandaria a mensagem para outra pessoa |
| g | `62 3212-4545` | Aceito e sinalizado como possível fixo |
| h | `062 99999-8888` e `+55 (062) 99999-8888` | Aceitos: prefixo de interurbano é retirado |
| i | `005562999998888` | Aceito: prefixo internacional é retirado |
| j | `Pizzaria do Zé` + tabulação + número + tabulação + `Goiânia` | Nome e cidade em campos separados |
| k | `Nome,Telefone,Cidade` (cabeçalho) | Vira linha recusada, não contato |
| l | `+1 415 555 2671` | Recusado: não é número brasileiro |
| m | `62999998888 62988887777` | Dois contatos |
| n | `Padaria - 62 3212-4545 ramal 22` | Nome "Padaria", sem o ramal |
| o | 50 mil caracteres de dígitos e espaços | Responde em milissegundos (sem travamento de expressão regular) |

### 10.7 Resposta de quem foi abordado

| # | Passo | Esperado |
|---|---|---|
| 10.7.1 | Contato responde a uma abordagem | Alvo vira `RESPONDEU`; contador de respostas do disparo sobe |
| 10.7.2 | Mesma pessoa manda a segunda mensagem | Contador **não** sobe de novo |
| 10.7.3 | Ler a resposta do assistente | Reconhece que o contato partiu de nós, faz **uma** pergunta e não se apresenta em lista |
| 10.7.4 | Dizer "não tenho interesse" | Assistente agradece e encerra; não argumenta nem oferece desconto |
| 10.7.5 | Perguntar de onde veio o número | Diz a verdade (prospecção da ChegowIA), sem afirmar que a pessoa pediu contato |
| 10.7.6 | Dizer "me tira dessa lista" | Confirma por escrito, bloqueia o número e encerra a conversa |
| 10.7.7 | Conferir a fila dos outros disparos depois do pedido | Pendentes daquele número viram `DESCARTADO` em **todos** os disparos |
| 10.7.8 | Colar o número bloqueado numa lista nova | Descartado na conferência, antes de qualquer envio |
| 10.7.9 | Remover o bloqueio à mão e recolar | Volta a ser aceito |
| 10.7.10 | Pedir para falar com humano | Vai para a equipe, como em qualquer conversa do canal |

---

## 11. Suporte da plataforma (10 rotas)

| # | Passo | Esperado |
|---|---|---|
| 11.1 | Lojista abre conversa pelo balão de suporte | Conversa criada |
| 11.2 | IA responde | Resposta automática registrada |
| 11.3 | Pedir atendimento humano (`:id/human`) | Conversa entra na fila do super admin |
| 11.4 | Super admin responde em `/super-admin/atendimento` | Mensagem chega ao lojista |
| 11.5 | Fechar conversa (`:id/close`) | Encerrada; histórico preservado |
| 11.6 | Lojista tenta ler conversa de outra empresa | Negado |

---

## 12. Promoções

| # | Passo | Esperado |
|---|---|---|
| 12.1 | Criar promoção | Aparece na vitrine da loja |
| 12.2 | Ativar/desativar (`:id/status`) | Some e volta na vitrine |
| 12.3 | Promoção expirada | Não aparece mais |
| 12.4 | Promoção de loja `isTestOnly` | Não aparece no público |

---

## 13. Fiscal — NFC-e

### 13.1 Cadastro e prontidão

| # | Passo | Esperado |
|---|---|---|
| 13.1.1 | Sem cadastro | **"Emissão não configurada"** com as pendências |
| 13.1.2 | Município de outra UF (IBGE 3106200 com estado SP) | Recusado |
| 13.1.3 | IE "ISENTO" e tentar Produção | Recusado — NFC-e exige contribuinte |
| 13.1.4 | Certificado de outro CNPJ | Recusado |
| 13.1.5 | Certificado vencido | Recusado com a data |
| 13.1.6 | `.pdf` no lugar do `.pfx` | Recusado |
| 13.1.7 | Senha errada | Mensagem única (arquivo ou senha) |
| 13.1.8 | Produto sem NCM/CFOP | Aparece na lista de pendências do cardápio |

### 13.2 Conexão com a SEFAZ

| # | Passo | Esperado |
|---|---|---|
| 13.2.1 | "Testar conexão" sem certificado | Recusa pedindo o certificado |
| 13.2.2 | Com certificado válido | Resposta da SEFAZ na tela; **nenhuma nota, nenhuma numeração** |
| 13.2.3 | Salvar `Ambiente = Produção` | Só conclui se a SEFAZ responder "Serviço em Operação" |

### 13.3 Emissão

| # | Passo | Esperado |
|---|---|---|
| 13.3.1 | Emitir de pedido pago | `AUTORIZADA`, chave de 44 dígitos, protocolo |
| 13.3.2 | Emitir duas vezes | Devolve a mesma nota |
| 13.3.3 | Produto sem tributação | Recusado **antes** de reservar numeração |
| 13.3.4 | Comanda com item cancelado | Item não entra no valor |
| 13.3.5 | DANFE HTML e `?formato=texto` | Chave em blocos de 4, QR, protocolo |
| 13.3.6 | Baixar XML | Assinado, `<Signature>` dentro de `<NFe>` |
| 13.3.7 | Com entrega e desconto | Cada item traz `vFrete`/`vDesc`; soma bate |
| 13.3.8 | Pagamento em cartão | XML traz `<card><tpIntegra>2</tpIntegra></card>` |
| 13.3.9 | `autoEmit` ligado + pedido pago | Nota sai sozinha |
| 13.3.10 | `autoEmit` ligado + mesa fechada | Nota sai sozinha, sem travar a liberação da mesa |
| 13.3.11 | `fiscal/nfce/pendentes-emissao` | Lista vendas pagas e mesas fechadas **sem** documento |
| 13.3.12 | Emitir uma da lista | Sai da lista depois de autorizada |
| 13.3.13 | Venda com nota rejeitada | **Continua** na lista — ela ainda não tem documento válido |
| 13.3.14 | Reenviar manualmente (`:id/transmitir`) uma nota em contingência | Transmite; se já autorizada, devolve a existente |
| 13.3.15 | Reenviar enquanto o worker envia a mesma | Conflito, sem envio duplicado |

### 13.4 Contingência e falhas

| # | Passo | Esperado |
|---|---|---|
| 13.4.1 | SEFAZ inacessível | `CONTINGENCIA` com `tpEmis 9`; **a venda não trava** |
| 13.4.2 | Restabelecer e aguardar o worker | Transmite e vira `AUTORIZADA` |
| 13.4.3 | Rejeição definitiva | `REJEITADA` e **e-mail imediato** aos administradores |
| 13.4.4 | Reemitir depois da rejeição | Nota nova, número novo |
| 13.4.5 | Documento preso em `ENVIANDO` | O worker consulta pela chave e concilia |

### 13.5 Eventos

| # | Passo | Esperado |
|---|---|---|
| 13.5.1 | Cancelar com justificativa de 10 caracteres | Recusado (mínimo 15) |
| 13.5.2 | Cancelar dentro de 30 min | `CANCELADA` com protocolo |
| 13.5.3 | Cancelar depois de 30 min | Recusado, explicando a alternativa |
| 13.5.4 | Carta de correção | Registrada, sequência incrementando |
| 13.5.5 | Inutilizar faixa com nota autorizada | Recusado |
| 13.5.6 | Inutilizar faixa livre | Documentos viram `INUTILIZADA` |

> **Sem certificado A1, 13.2 em diante não roda.** Marque como não executado e valide
> a estrutura: gerar o XML pelo código e conferir contra os XSD oficiais 4.00 com
> `xmllint --schema`.

---

## 14. Assinatura e pagamento

### 13.9 Filtro de cidade na vitrine

| # | Passo | Esperado |
|---|---|---|
| 13.9.1 | Buscar pela cidade da sede | Loja aparece |
| 13.9.2 | Buscar pela cidade vizinha onde a loja cadastrou área de entrega | Loja aparece — era o caso que faltava |
| 13.9.3 | Área de entrega desativada naquela cidade | Loja não aparece |
| 13.9.4 | Cidade sem acento ("sao paulo") | Aparece: a collation da coluna ignora acento e caixa |
| 13.9.5 | Cidade que contém o nome ("São Paulo Capital") | **Não** aparece: a comparação é por igualdade, não substring |
| 13.9.6 | Cidade sem relação nenhuma | Não aparece |
| 13.9.7 | `city` em branco ou só espaços | Não vira filtro vazio; devolve o catálogo inteiro |

---

### 14.0 Carência de 7 dias no catálogo

A loja sai do ar 7 dias depois de a assinatura vencer, e volta sozinha quando o
pagamento entra. Cortar no mesmo dia tiraria a loja do ar por um Pix que demorou
algumas horas; não cortar nunca deixava quem parou de pagar vendendo para sempre.

| # | Passo | Esperado |
|---|---|---|
| 14.0.1 | Assinatura em dia | Loja no diretório, no sitemap, na home e aceitando pedido |
| 14.0.2 | Vencida há 3 dias | Tudo continua funcionando; painel do lojista avisa que faltam 4 dias |
| 14.0.3 | Vencida há 8 dias | Fora do diretório, do sitemap e da home; a página da loja dá 404 |
| 14.0.4 | Cotação de entrega com a loja fora do ar | Recusada com "loja temporariamente indisponível" |
| 14.0.5 | Pedido pelo link direto com a loja fora do ar | Recusado — esconder do catálogo não bastava |
| 14.0.6 | Pedido montado pelo WhatsApp da loja fora do ar | Recusado pelo mesmo motivo |
| 14.0.7 | Pagamento confirmado | Loja volta imediatamente, sem intervenção |
| 14.0.8 | Teste gratuito vencido há mais de 7 dias sem pagar | Mesma regra do período pago |
| 14.0.9 | Empresa criada pelo super admin, sem assinatura | Continua visível: nunca passou pelo cadastro com plano |
| 14.0.10 | Painel do lojista com a loja já fora | Aviso vermelho dizendo que ela não aparece nem aceita pedido |

R$ 159,90/mês, 7 dias de teste.

### 14.1 Teste e ativação

| # | Passo | Esperado |
|---|---|---|
| 14.1.1 | Contratar sem código de revendedor | Teste de 7 dias começa |
| 14.1.2 | Usar o painel durante o teste | Tudo liberado |
| 14.1.3 | Forçar o fim do teste | Painel bloqueado, tela de ativação |
| 14.1.4 | Abrir a ativação | Três formas com valor de cada |
| 14.1.5 | Pix | **R$ 159,90** |
| 14.1.6 | Boleto | **R$ 159,90** |
| 14.1.7 | Cartão | **R$ 165,33** (taxa por dentro; líquido R$ 159,90) |
| 14.1.8 | Gerar fatura | Abre no Asaas travada na forma escolhida |

### 14.2 Troca de forma

| # | Passo | Esperado |
|---|---|---|
| 14.2.1 | Com fatura aberta, trocar cartão → Pix | Fatura cai para R$ 159,90 e reabre atualizada |
| 14.2.2 | Conferir a assinatura no Asaas | Próximas cobranças na nova forma |
| 14.2.3 | Trocar com fatura já paga | A paga não muda; só as futuras |

### 14.3 Pagamento e ciclo

| # | Passo | Esperado |
|---|---|---|
| 14.3.1 | Pagar por Pix | Acesso em segundos (`PAYMENT_RECEIVED`) |
| 14.3.2 | Pagar por cartão | Acesso com `PAYMENT_CONFIRMED`, antes de compensar |
| 14.3.3 | Perder o webhook | Conciliação do worker libera assim mesmo |
| 14.3.4 | Vencer sem pagar | Acesso bloqueado |
| 14.3.5 | Pagar depois de vencido | Acesso volta |
| 14.3.6 | Cancelar assinatura | Acesso até o fim do período pago |
| 14.3.7 | Webhook duplicado | Não ativa duas vezes |

> **Ordem no worker:** se a conciliação do Asaas falhar numa rodada, o corte por
> vencimento **não** roda. Confira no log: "Corte de acesso por vencimento adiado".

---

## 15. Revendedor

### 15.1 Candidatura

| # | Passo | Esperado |
|---|---|---|
| 15.1.1 | Enviar por `/revenda` | Registro pendente |
| 15.1.2 | Super admin aprova | Perfil com **código único** e 30% |
| 15.1.3 | Reprovar outra | Sem perfil; motivo registrado |
| 15.1.4 | Login | Cai em `/revendedor/dashboard` |
| 15.1.5 | `resellers/admin/applications` | Fila de candidaturas para o super admin |
| 15.1.6 | `resellers/admin/applications/:id/resume` | Resumo da candidatura antes de decidir |
| 15.1.7 | `resellers/admin/profiles` | Lista os revendedores ativos, com código e situação |
| 15.1.8 | `resellers/applications/:id/status` | O candidato acompanha sem estar logado como revendedor |

### 15.2 Recebimento

| # | Passo | Esperado |
|---|---|---|
| 15.2.1 | Cadastrar subconta Asaas | Formulário conforme o provedor |
| 15.2.2 | Sacar antes de concluir | Recusado, explicando o que falta |

### 15.3 Indicação com desconto

| # | Passo | Esperado |
|---|---|---|
| 15.3.1 | Contratar **com o código** | Assinatura vinculada ao revendedor |
| 15.3.2 | Tela de ativação do novo cliente | Pix/boleto **R$ 135,92**; cartão **R$ 140,61** |
| 15.3.3 | `/painel/assinatura` do cliente | Mostra o código e o fim do desconto |
| 15.3.4 | Avançar 3 meses e rodar o worker | Volta a R$ 159,90; `discountRemovedAt` preenchido |
| 15.3.5 | Rodar o worker de novo | Não repete |
| 15.3.6 | Código inválido na contratação | Recusado, sem vincular |

### 15.4 Comissão

| # | Passo | Esperado |
|---|---|---|
| 15.4.1 | 1ª mensalidade com desconto | **R$ 40,78** (30% de 135,92) |
| 15.4.2 | Logo após `PAYMENT_CONFIRMED` | Existe, mas **não** liberada |
| 15.4.3 | Após `PAYMENT_RECEIVED` | "Disponível para saque" |
| 15.4.4 | Mensalidade sem desconto | **R$ 47,97** (30% de 159,90) |
| 15.4.5 | Fatura com consumo extra | Comissão para na mensalidade |
| 15.4.6 | Contestação | Vai para "em análise", não sacável |

### 15.5 Prazos exibidos

Em `/revendedor/financeiro`: Pix mesmo dia · Boleto 1 a 2 dias úteis · Débito até 3
dias úteis · Crédito 32 dias corridos.

### 15.6 Saque

| # | Passo | Esperado |
|---|---|---|
| 15.6.1 | Saldo abaixo de R$ 10 | Recusado |
| 15.6.2 | Saldo suficiente | Lote criado; comissões em `PROCESSANDO`; e-mail |
| 15.6.3 | Segundo pedido com lote em andamento | Recusado |
| 15.6.4 | Duas solicitações simultâneas | Só uma vence |
| 15.6.5 | Transferência confirmada | Comissões `PAGA` |

### 15.7 Leads e prospects

| # | Passo | Esperado |
|---|---|---|
| 15.7.1 | Cadastrar prospect | Aparece só para ele |
| 15.7.2 | Reivindicar lead | Vinculado; evento `lead.claimed` |
| 15.7.3 | Outro revendedor tenta o mesmo | Recusado |
| 15.7.4 | Lead vira cliente | `CONVERTIDO` |
| 15.7.5 | Perguntar ao assistente sobre o código | Responde o código e a regra de 15% por 3 meses |

---

## 16. Super admin

| # | Passo | Esperado |
|---|---|---|
| 16.1 | `/super-admin/dashboard` | Números da plataforma |
| 16.2 | `/super-admin/empresas` | Lista e detalhe sem senha da empresa |
| 16.3 | `/super-admin/empresas/nova` | Nasce comercial (`isTestOnly = false`) |
| 16.4 | Ativar/desativar empresa (`:id/status`) | Some/volta da vitrine |
| 16.5 | `/super-admin/planos` | Preço novo vale para nova contratação, não para as existentes |
| 16.6 | `/super-admin/aprovacoes` | Aprovar/reprovar candidaturas |
| 16.7 | `/super-admin/operacao` | Fila de eventos e dead-letters |
| 16.8 | `reports/global/overview` | Total de empresas, pedidos e receita da plataforma |
| 16.8.1 | `reports/global/top-companies` | Ranking coerente com o movimento das empresas |
| 16.8.2 | `reports/global/growth` | Série temporal de crescimento |
| 16.8.3 | Abrir relatório global como ADMIN de empresa | Negado |
| 16.9 | `usage/admin/rates` | Alterar tarifa de consumo |
| 16.10 | `billing/admin/operational-status` | Situação da fila: pendentes, mortos, atrasos |
| 16.11 | Reprocessar evento morto (`billing/admin/stripe-events/:id/retry`) | Volta para a fila e é processado |
| 16.12 | Reprocessar evento já concluído | Não duplica efeito |
| 16.13 | Trocar o administrador de uma empresa (`companies/:id/admin`) | Novo admin acessa; o anterior perde o painel |
| 16.14 | `/super-admin/conta` | Perfil e senha do próprio super admin |
| 16.15 | `permissions` (GET) | Lista as chaves disponíveis, usada na tela de funcionários |

### 16.16 Acesso assumido

| # | Passo | Esperado |
|---|---|---|
| 16.16.1 | Gerar link para uma empresa | Validade curta |
| 16.16.2 | Abrir o link | Entra no painel **daquela empresa** |
| 16.16.3 | Conferir o token | Papel e `companyId` da empresa; `sub` continua o super admin |
| 16.16.4 | Reutilizar link consumido | Recusado |
| 16.16.5 | Encerrar | Volta ao super admin |
| 16.16.6 | Acesso assumido de revendedor | Escrita bloqueada onde a regra exige |
| 16.16.7 | Evento `session.revoked` | A sessão assumida cai sozinha ao ser revogada |

---

## 17. Tempo real (websocket)

Abra o painel numa aba e provoque o evento em outra. **Nada pode exigir recarregar.**

| Evento | Como provocar |
|---|---|
| `order.created` | Pedido pelo site, mesa ou WhatsApp |
| `delivery.updated` | Motoboy avança status ou envia localização |
| `table.opened` / `table.changed` / `table.closed` | Operar comanda |
| `whatsapp.message.received` / `.sent` | Mensagem no canal da empresa |
| `whatsapp.conversation.updated` | Atribuir/encerrar conversa |
| `platform.whatsapp.*` | Canal institucional |
| `lead.available` / `lead.claimed` | Novo lead e reivindicação |
| `access.updated` / `company.access.paused` | Bloqueio por assinatura |
| `session.revoked` | Encerrar acesso de suporte |
| `whatsapp.access.requested` | Empresa pede o canal |

Teste também: derrubar a rede do navegador e voltar — a tela deve reconectar.

---

## 18. Saúde e observabilidade

| # | Passo | Esperado |
|---|---|---|
| 18.1 | `GET /api/health/live` | 200 sempre que o processo está de pé |
| 18.2 | `GET /api/health/ready` | 200 só com o banco acessível |
| 18.3 | Derrubar o MySQL e chamar `ready` | Falha, e o container é reiniciado pelo orquestrador |
| 18.4 | `GET /api/health/metrics` sem `METRICS_TOKEN` | Rota desligada |
| 18.5 | Com token certo | Formato Prometheus |
| 18.6 | Com token errado | Negado |
| 18.7 | `APP_ROLE=api` | Log diz que a fila não roda ali |
| 18.8 | `APP_ROLE=worker` | Jobs rodam; HTTP interno responde ao health |

---

## 19. Checklist rápido de regressão

1. `npm run verify` — exit 0
2. `npm run test:e2e` — exit 0
3. Cada papel abre o que deve e é negado no que não deve (7.2)
4. Isolamento multiempresa (7.4)
5. Pedido do consumidor até `ENTREGUE`, com motoboy (5.3 + 6.1 + 8.1)
6. Emitir NFC-e e abrir o DANFE (13.3.1, 13.3.5)
7. Ativação mostrando os três valores (14.1.4–14.1.7)
8. Um evento de websocket chegando sem recarregar (17)

---

## 20. O que não dá para testar sozinho

Registre como **não executado**, nunca como aprovado.

| Assunto | Por quê | Alternativa |
|---|---|---|
| Emissão real na SEFAZ | Certificado A1 e credenciamento | XSD oficial + "Testar conexão" |
| Cobrança real no Asaas | Conta e chave de produção | Ambiente de teste do Asaas + testes de webhook |
| Recebimento do revendedor | Subconta Asaas real | Conferir criação do lote e chamada da transferência |
| WhatsApp de verdade | Gupshup configurado e número aprovado | Testes de formato e invariantes de schema |
| Assistentes de IA | `DEEPSEEK_API_KEY` | Testes de intenção de busca e de cozinha |
| Rota real | OSRM público pode limitar | Subir OSRM local em `ROUTING_BASE_URL` |
| Security do GitHub | Advanced Security no plano | O portão de CVE roda e falha sozinho |

---

## 21. Pendências conhecidas

Não são falhas novas — não reporte como se fossem.

- **Grupo IBS/CBS da Reforma não é emitido.** Rejeições suspensas em 01/08/2026;
  Simples Nacional passa a dever em 01/01/2027.
- **Prospecção depende de modelo aprovado pela Meta.** Sem um modelo aprovado
  cadastrado, nenhuma abordagem a número novo sai — e isso não é defeito, é
  regra da API oficial. A aprovação é feita no painel do Gupshup e leva de
  minutos a alguns dias.
