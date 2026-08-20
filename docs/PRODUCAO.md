# Publicação do ChegowIA

Esta implantação mantém banco, imagens e documentos no próprio servidor. Não usa
S3 nem qualquer serviço da AWS.

## 1. Servidor e DNS

- Linux atualizado com Docker Engine e Compose Plugin.
- Mínimo recomendado: 4 vCPU, 8 GB de RAM e disco SSD. O ClamAV mantém a base de
  assinaturas em memória e é o componente mais pesado.
- Registro `A`/`AAAA` do domínio apontando para o servidor.
- Firewall expondo apenas SSH administrativo, `80/tcp`, `443/tcp` e `443/udp`.
  MySQL, API, Next e ClamAV permanecem em redes internas do Compose.
- Crie `/srv/chegowia/data` e `/srv/chegowia/backups` em disco persistente.

## 2. Segredos

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -base64 48
```

Use senhas diferentes para MySQL root, usuário da aplicação, super-admin, SMTP e
demais integrações. Caracteres especiais da senha do MySQL precisam estar
percent-encoded em `DATABASE_URL`; `MYSQL_PASSWORD` continua com o valor original.

Nunca copie para produção as chaves que foram usadas ou compartilhadas durante o
desenvolvimento. Revogue-as e crie novas chaves de DeepSeek e Stripe.

## 3. E-mail

Configure uma caixa transacional real em `SMTP_*` e valide SPF, DKIM e DMARC no
domínio. Teste confirmação de e-mail, redefinição de senha e código de segundo
fator antes de abrir cadastros.

`OPS_ALERT_EMAIL` é obrigatório e não é uma caixa de lojista: é onde chegam os
avisos de evento Stripe que esgotou as tentativas e de repasse encerrado sem
confirmação. Sem alguém lendo essa caixa, uma fatura paga que não virou acesso
só aparece se alguém abrir `/super-admin/operacao` por conta própria.

## 4. Stripe

1. Ative Billing, Customer Portal e Connect Express na conta da plataforma.
2. Crie um preço mensal recorrente em BRL com o valor exibido no ChegowIA.
3. Inicie a plataforma, entre como super-admin e salve o `price_...` em
   **Planos e billing**. A API valida moeda, recorrência e valor exato.
4. Crie no Stripe Workbench um destino de eventos da conta da plataforma para:

   ```text
   https://SEU_DOMINIO/api/billing/stripe/webhook
   ```

5. Selecione:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
6. Copie o segredo `whsec_...` desse destino para `STRIPE_WEBHOOK_SECRET`.
7. Crie um segundo destino, desta vez para eventos das **contas conectadas**:

   ```text
   https://SEU_DOMINIO/api/billing/stripe/connect-webhook
   ```

   Selecione apenas `account.updated` e salve o segredo desse segundo destino em
   `STRIPE_CONNECT_WEBHOOK_SECRET`.
8. Faça uma compra completa em homologação, incluindo desconto de revendedor,
   renovação, falha, reembolso, comissão e repasse.

O formulário Checkout já usa `pt-BR`. O desconto de indicação é criado pela API
como 15% recorrente durante três meses e só é aplicado quando o cadastro está
vinculado a um revendedor válido. A tela **Saúde operacional** do super-admin
mostra webhooks e repasses com falha.

### Custos variáveis de IA e WhatsApp

O plano padrão é R$ 159,90/mês. A página **Super admin → Planos e billing** também
mantém a tabela de custo por 1 milhão de tokens de IA e por tipo de mensagem WhatsApp.
O backend grava a taxa vigente junto de cada evento, consolida o valor por métrica e
cria itens idempotentes na próxima invoice Stripe.

A margem padrão é 200% sobre IA e 30% sobre WhatsApp (migração
`20260802090000_configure_usage_margin`, que só preenche o que estava zerado — não
sobrescreve ajuste feito pelo painel). A taxa é fotografada no evento, então mudar a
margem não recalcula consumo já registrado.

Valores de consumo abaixo de um centavo são exibidos com as casas necessárias
(`R$ 0,0021`) e acumulam no razão até fecharem um centavo, quando entram na fatura.
Exibi-los com duas casas os mostraria como `R$ 0,00` e o lojista concluiria que nada foi
contabilizado.

As taxas de custo do provedor foram cadastradas em 31/07/2026: DeepSeek V4 Flash
R$ 0,710822/1M tokens de entrada sem cache, R$ 0,014216/1M de entrada com cache e
R$ 1,421644/1M de saída; Meta WhatsApp Brasil: serviço gratuito, utilidade e
autenticação R$ 0,0350, marketing R$ 0,3217 por mensagem entregue. O DeepSeek foi
convertido pela PTAX de venda 5,0773. Revise as taxas antes de ativar cobrança live
quando houver mudança de câmbio, modelo, país destinatário ou faixa de volume Meta.

## 5. WhatsApp pelo Gupshup

O canal de WhatsApp é atendido pelo Gupshup, que é o BSP homologado pela Meta. A
plataforma não fala com a Cloud API da Meta diretamente: quem responde à Meta
pelo aplicativo é o Gupshup, o que dispensa App Review próprio da ChegowIA.

**Consequência que precisa estar clara para o cliente:** o número conectado sai
do aplicativo WhatsApp Business. O Gupshup não oferece coexistência, então o
atendimento passa a acontecer só pela plataforma.

1. Crie a conta em `gupshup.io` e pegue a **apikey** (nível da conta, não do app).
2. Defina no ambiente:

   ```text
   GUPSHUP_ENABLED=true
   GUPSHUP_MODE=SELF_SERVE
   GUPSHUP_API_KEY=<apikey da conta>
   GUPSHUP_WEBHOOK_TOKEN=<openssl rand -hex 32>
   WHATSAPP_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
   API_PUBLIC_URL=https://SEU_DOMINIO
   ```

   `GUPSHUP_WEBHOOK_TOKEN` viaja na URL do callback e é a única prova de origem —
   o Gupshup não assina o corpo como a Meta fazia. Trocá-lo exige atualizar a URL
   no painel deles no mesmo momento, senão o callback passa a responder 401.

   `WHATSAPP_TOKEN_ENCRYPTION_KEY` cifra o token de cada aplicativo em repouso.
   Trocar essa chave torna ilegíveis os canais já conectados: só reconectando.

3. **Ative o alerta de saldo baixo** na carteira do Gupshup. Todos os clientes
   consomem a mesma carteira, e saldo negativo faz o Gupshup aceitar a mensagem
   (`status: submitted`) sem entregá-la — falha silenciosa que derruba todos os
   números ao mesmo tempo.

### Conectar cada empresa (modo self-serve)

No self-serve não há API para criar aplicativo por cliente, então o passo é
manual e o pedido do empresário é o gatilho.

1. A empresa clica em **Solicitar acesso ao WhatsApp** no painel dela. Isso avisa
   a equipe por e-mail (`OPS_ALERT_EMAIL`) e em tempo real no super-admin.
2. No painel do Gupshup, crie um app do tipo **Access API** com nome único, sem
   espaço nem acento.
3. Na aba **Webhooks** do app, cole a URL de callback que o card do super-admin
   exibe. Ela aceita tanto o formato Meta (v3) quanto o nativo do Gupshup.
4. Inicie o onboarding do número. No passo do Facebook, copie o link de
   **Direct Facebook Registration** e pare — não conclua você.
5. Em **Super-admin → Empresas → [empresa]**, preencha nome do aplicativo, App ID
   e o link de cadastro.
6. A empresa conclui pelo botão **Conectar meu WhatsApp**, com o Facebook dela.
   Você nunca acessa a conta do cliente.
7. Preencha o **número** no card para ativar o canal.

O App ID é obrigatório para editar o perfil do WhatsApp (foto, descrição,
contatos) pelo painel — sem ele essa seção não aparece.

### Custo por mensagem

O Gupshup cobra a taxa de plataforma dele em **toda** mensagem, inclusive nas
recebidas e nas de serviço. Medido em produção: USD 0,001 por mensagem. Sobre isso
vem a tarifa da Meta, que é zero na mensagem de serviço e varia por categoria de
template. A tabela de `UsageRate` já reflete essa soma.

Atenção ao medir consumo: mensagens **recebidas** consomem carteira mas não são
faturadas hoje, porque o registro de uso acontece só no envio.

## 6. Primeira implantação

```bash
docker compose --env-file .env.production -f compose.production.yml config
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml run --rm api \
  node apps/api/dist/bootstrap-production.js
sh infra/check-production.sh
```

As migrações são aplicadas automaticamente antes de cada inicialização da API.
O bootstrap é idempotente, cria permissões, plano inicial e o primeiro
super-admin, sem carregar hamburgueria ou usuários demonstrativos.

Depois do primeiro acesso, troque a senha inicial e remova
`SEED_SUPER_ADMIN_PASSWORD` do arquivo de ambiente.

### Serviços `api` e `worker`

São a mesma imagem com `APP_ROLE` diferente. `api` atende HTTP e não processa
fila; `worker` processa a fila de eventos Stripe, os repasses, a sincronização
de uso e a limpeza periódica, e fica só na rede interna — o Caddy não roteia
para ele.

Consequências práticas:

- **`api` pode escalar; `worker` não.** Mantenha exatamente uma réplica do
  worker. Os claims são atômicos (`updateMany` condicional), então duplicar não
  corrompe nada, mas também não acelera.
- **Reiniciar a API não segura mais o processamento de dinheiro.** Era o motivo
  da separação: deploy, OOM ou health check falho da API prendiam a fila.
- Se o worker cair, nada processa. Acompanhe o health dele:
  `docker compose -f compose.production.yml ps worker`.
- Sem `APP_ROLE` definido, o processo faz as duas coisas — é o padrão de
  desenvolvimento e o comportamento anterior.

### Fiscal

`FISCAL_ENCRYPTION_KEY` (32 bytes, `openssl rand -base64 32`) cifra o certificado
digital A1 e o CSC em repouso. Precisa ser **diferente** de
`WHATSAPP_TOKEN_ENCRYPTION_KEY` — o boot recusa se forem iguais. O motivo é
concreto: o que está guardado sob essa chave é a chave privada com a qual se
assina documento fiscal em nome da empresa; compartilhar a cifragem faria um
vazamento virar dois e impediria rotacionar uma sem mexer na outra.

Perder essa chave torna os certificados já enviados ilegíveis — cada lojista
precisaria reenviar o arquivo. Guarde-a com o mesmo cuidado do backup do banco,
e **em outro lugar**: chave junto do dump cifrado por ela não protege nada.

O certificado nunca vai para disco. Chega em memória pelo upload, é lido para
extrair titular e validade, e vai cifrado direto para o banco — coerente com o
container rodar em `read_only`.

O aviso de vencimento sai do serviço `worker`, a cada 6 horas, para os
administradores da empresa, começando 30 dias antes e no máximo uma vez por
semana. Se o worker estiver fora do ar, ninguém é avisado.

### Emissão de NFC-e

Ordem obrigatória. Pular etapa produz rejeição a cada venda, com o cliente no balcão.

1. **Credenciamento da empresa** como emitente de NFC-e na SEFAZ do estado. É o que libera o
   CSC de produção; sem ele o certificado é válido e a nota é recusada de qualquer forma.
2. **Cadastro fiscal completo** e certificado A1 enviado (Painel > Fiscal). A tela lista o que
   falta. A inscrição estadual precisa ser de contribuinte de ICMS — empresa isenta não emite
   NFC-e, e a plataforma recusa a virada para produção nesse caso.
3. **Tributação do cardápio** sem pendências — padrões da empresa resolvem a maioria; o
   restante é por produto.
4. **CSC de produção** (identificador e token) obtido no portal da SEFAZ do estado. É diferente
   do CSC de homologação.
5. **Ambiente = Produção.** Ao salvar, a plataforma conversa com a SEFAZ do estado usando o
   certificado da empresa (consulta de status do serviço) e só conclui a virada se ela
   responder "Serviço em Operação". Esse teste não emite nota nem gasta numeração, e pode ser
   repetido a qualquer momento pelo botão **Testar conexão** — vale rodar antes de abrir a loja.
6. **Primeira nota à mão**, em Painel > Notas fiscais, sobre uma venda real. É ela que revela
   erro de NCM, CFOP, código de município ou credenciamento.
7. Só depois **ligue emitir automaticamente**. A plataforma recusa ligar antes de existir uma
   nota autorizada no ambiente: no automático, um erro de cadastro se repetiria em cada venda
   até alguém perceber.

Indo direto para produção, sem homologação: o teste de conexão do passo 5 cobre certificado,
TLS e endpoint, e o passo 6 cobre o resto. O que nenhum dos dois cobre é o cadastro de outra
empresa — cada lojista novo repete os dois passos.

**Rejeição definitiva agora avisa na hora.** Quando a SEFAZ recusa por algo que não se resolve
reenviando, os administradores da empresa e o `OPS_ALERT_EMAIL` recebem o código, o motivo e a
orientação — junto com o aviso de que aquele número precisa ser inutilizado. Antes, a venda
ficava sem documento em silêncio até alguém abrir a tela.

**IBS e CBS (Reforma Tributária).** O ChegowIA ainda não emite o grupo `IBSCBS`. Isso hoje não
rejeita nota: o Ato Técnico Conjunto RFB/CGIBS nº 1/2026, de 01/08/2026, suspendeu as regras de
rejeição (UB12-10 / 1115) para data futura. Empresa do **Simples Nacional** só passa a dever
esses campos em **01/01/2027**; empresa do **regime normal** já deve desde **03/08/2026**, sem
rejeição técnica — a tela mostra esse aviso para quem está no regime normal. Emitir o grupo é
trabalho pendente e precisa entrar antes de a rejeição voltar.

O que acontece quando a SEFAZ cai: a venda **não** para. A nota é assinada em contingência
offline (`tpEmis 9`), o cupom sai com o aviso "pendente de autorização" e o serviço `worker`
transmite quando o estado voltar, com espera crescente até 30 minutos. Depois de 10 tentativas
sem sucesso, sai alerta para `OPS_ALERT_EMAIL`.

Estados habilitados: os 26 e o DF. AM, GO, MG, MS, MT, PR, RS e SP mantêm webservice próprio de
NFC-e; os outros dezenove são atendidos pelo SVRS. As duas tabelas — endpoints em
`fiscal/nfce/sefaz-endpoints.ts` e URL do QR Code em `fiscal/nfce/qr-code.ts` — andam juntas e a
emissão recusa antes de reservar numeração se faltar qualquer uma, para não abrir buraco na
sequência.

Empresa em regime normal com **CST 20** precisa preencher a redução da base de cálculo em
Painel > Fiscal: o layout exige o percentual junto do CST e a nota é recusada sem ele. O campo
aparece no formulário assim que o CST 20 é escolhido.

Cancelamento vale por 30 minutos após a autorização. Passou disso, é procedimento contábil.
Toda nota rejeitada queima um número: use **Inutilizar numeração** em Painel > Notas fiscais,
senão a sequência fica com buracos que a fiscalização cobra.

### Zerar a base antes de entrar com clientes reais

`apps/api/prisma/reset-data.js` apaga os dados operacionais e preserva o super
administrador, as permissões, os planos e as tarifas de consumo. As migrations
continuam aplicadas — o schema não é recriado.

```sh
# no Shell do serviço, dentro de /app — só mostra o que seria apagado
node apps/api/prisma/reset-data.js

# executa; o nome tem de bater com o banco ao qual a conexão chegou
node apps/api/prisma/reset-data.js --confirmar=<nome-do-banco>
```

A confirmação por nome existe porque `DATABASE_URL` é variável de ambiente: o
comando certo apontando para o banco errado é o acidente que este script tem de
impedir. Sem o parâmetro, ele nunca escreve nada.

A ordem de exclusão é lida do `information_schema` a cada execução, então tabela
nova entra sozinha — não há lista para manter desatualizada.

O **WhatsApp institucional da ChegowIA** é preservado: canal, conversas, mensagens
e o consumo da plataforma. Ele é da plataforma, não de nenhum cliente — apagar
derrubaria o número e exigiria reconectar no Gupshup. O canal de WhatsApp de cada
empresa (`MessagingChannel`) é apagado junto com a empresa, como deve ser.

**Não há desfazer.** Faça o backup antes, sempre.

### Observabilidade

`GET /api/health/metrics?token=$METRICS_TOKEN` expõe o formato Prometheus. Sem
`METRICS_TOKEN` a rota fica desligada — ela revela volume de pedidos e latência, informação
comercial da operação de cada lojista.

Os quatro números que valem alerta:

- `chegowia_stripe_events_pending` crescendo — fila de cobrança parada.
- `chegowia_payouts_processing` alto por mais de uma hora — repasse travado.
- `chegowia_fiscal_documents_pending` — notas em contingência não transmitidas.
- `chegowia_fiscal_certificates_expiring` — certificados a menos de 30 dias do vencimento.

Todos são consultados no banco no momento da raspagem e valem `-1` se a consulta falhar,
o que por si só já é sinal de problema.

## 7. Arquivos locais e antivírus

- Imagens públicas: `${DATA_ROOT}/uploads`.
- Currículos privados: `${DATA_ROOT}/private_uploads`; nunca são servidos pelo
  proxy, somente por endpoint autenticado de super-admin.
- Assinaturas do ClamAV: `${DATA_ROOT}/clamav`.
- O backend valida bytes reais do arquivo, usa nomes aleatórios e submete
  documentos ao ClamAV antes de persistir.

O serviço `storage-init` corrige as permissões dos diretórios para o usuário não
privilegiado da API. Não coloque `private_uploads` dentro de uma raiz pública.

## 8. Backup e restauração

Agende diariamente:

```cron
17 3 * * * cd /caminho/chegowia && /bin/sh infra/backup.sh >> /var/log/chegowia-backup.log 2>&1
```

### A cópia precisa sair do servidor

Backup que mora no mesmo disco do banco não é backup. Disco morto, incêndio ou
conta encerrada no provedor levam o dado e a cópia juntos — e aqui há nota fiscal
autorizada, com guarda obrigatória de cinco anos.

Configure um destino em `.env.production`:

```sh
# rclone (recomendado: um remoto `crypt` cifra antes de a cópia sair daqui)
BACKUP_REMOTE=chegowia-cripto:backups
# ou outra máquina por SSH
BACKUP_RSYNC_TARGET=backup@outrohost:/srv/chegowia-backups
```

Sem nenhum dos dois, `infra/backup.sh` gera o backup local, avisa e sai com
código 2 — para o cron reclamar em vez de a ausência da cópia passar meses sem
ninguém notar. Depois de enviar, o script confere o que chegou (`rclone check`):
cópia truncada por queda de rede não dá sintoma.

### Ficar só com o backup local

É uma decisão possível, e ela tem de ser dita em voz alta:

```sh
BACKUP_ALLOW_LOCAL_ONLY=true
```

Aí o script termina com sucesso, mas repete o risco a cada execução: banco e
cópia no mesmo disco, e documento fiscal autorizado com guarda obrigatória de
cinco anos. A alternativa a esse aceite explícito seria conviver com um cron
vermelho toda noite — o que treina a ignorar exatamente o aviso que um dia vai
importar.

`infra/check-production.sh` falha quando o último backup tem mais de 48 horas, e
é assim que se descobre que o agendamento nunca foi instalado antes de precisar
dele. Com backup somente local ele passa, mas imprime o aviso junto do resultado.

O backup contém dump consistente do MySQL, imagens, currículos, manifesto e
checksums. A retenção padrão é 14 dias (`BACKUP_RETENTION_DAYS`).

**Restaure uma vez antes de precisar.** Backup que ninguém restaurou é suposição,
não cópia de segurança. Faça em uma máquina separada:

```bash
CONFIRM_RESTORE=YES BACKUP_DIR=/srv/chegowia/backups/AAAA... \
  /bin/sh infra/restore.sh
```

## 8.1 Saber do erro antes do cliente

Sem `SENTRY_DSN` o erro fica só no log do container — e quem descobre a falha é o
cliente, ligando, quando o log já rodou no rodízio.

```sh
SENTRY_DSN=https://...@....ingest.sentry.io/...
SENTRY_ENVIRONMENT=producao
APP_VERSION=          # opcional; agrupa os erros por versão publicada
```

O que **não** sai da máquina: corpo de requisição, cabeçalho, cookie, parâmetro
de consulta, dado de usuário e qualquer campo cujo nome pareça sensível (senha,
token, CPF, CNPJ, cartão, chave, certificado). O que viaja é o rastro de pilha e
o `requestId`, que é o que liga o relato à linha do log guardada aqui.

Erro de tela também chega: a página manda para `POST /api/observability/client-error`
e a API repassa. Isso evita colocar a chave do serviço no navegador e mantém a
limpeza de dado num único lugar.

Rastreamento de desempenho fica desligado (`tracesSampleRate: 0`). Ligar é uma
decisão separada, porque abre um segundo canal de dados.

## 9. Atualizações e rollback

Antes de cada atualização:

```bash
sh infra/backup.sh
npm run verify
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
sh infra/check-production.sh
```

Não apague volumes em um rollback. Volte para a imagem/código anterior somente
se as migrações forem compatíveis; para regressão de banco, use uma restauração
testada e uma janela de manutenção.

## 10. Checklist de aceite

- DNS e HTTPS válidos, redirecionamento de HTTP e headers de segurança.
- `npm run verify` e auditoria de dependências sem vulnerabilidades de produção.
- Cadastro, confirmação de e-mail, MFA e recuperação de senha.
- Perfis CLIENTE, ADMIN, FUNCIONARIO, COZINHA, MOTOBOY, REVENDEDOR e SUPER_ADMIN.
- Cobertura e horário da loja; delivery, mesas, cancelamento e pagamento.
- Problema de entrega com motivo, aviso, resolução e retomada.
- Checkout com e sem indicação, portal do cliente, webhook e reembolso.
- Connect Express, conta aprovada, comissão madura e repasse.
- Webhook Meta assinado, escolha IA/humano, inbox por empresa e consumo variável na
  próxima invoice Stripe.
- Upload malicioso bloqueado e currículo privado inacessível publicamente.
- Backup restaurado em ambiente isolado.
- Alertas externos consultando `/api/health/live` e `/api/health/ready`.
- Política de Privacidade e Termos revisados por profissional jurídico brasileiro.
