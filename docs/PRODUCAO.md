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

## 5. WhatsApp Cloud API (Meta)

Esta é uma configuração **única da ChegowIA**. Depois dela, cada empresário faz o
próprio vínculo pelo botão **Conectar meu WhatsApp** no painel; ele não recebe IDs,
token, webhook ou PIN técnico.

1. No App Meta da plataforma, adicione o produto **WhatsApp** e **Facebook Login for
   Business**. Crie uma configuração do tipo **WhatsApp Embedded Signup** e guarde o
   `Configuration ID`. Nos domínios/redirecionamentos permitidos do Facebook Login for
   Business, inclua `https://chegowia.com.br` e
   `https://chegowia.com.br/painel/configuracoes` (ou o domínio/rota equivalentes do
   ambiente publicado).
2. Defina no ambiente:

   ```text
   WHATSAPP_CLOUD_API_ENABLED=true
   META_EMBEDDED_SIGNUP_ENABLED=true
   META_APP_ID=<app-id-meta>
   META_EMBEDDED_SIGNUP_CONFIG_ID=<configuration-id-do-embedded-signup>
   API_PUBLIC_URL=https://SEU_DOMINIO
   META_APP_SECRET=<app-secret>
   WHATSAPP_WEBHOOK_VERIFY_TOKEN=<segredo-aleatorio-com-16+-caracteres>
   WHATSAPP_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
   ```

   No `compose.production.yml` deste projeto, `API_PUBLIC_URL=https://chegowia.com.br`
   pode ser o mesmo domínio do front-end: o Caddy encaminha `/api/*` para a API Nest.

3. No dashboard Meta, cadastre:

   ```text
   https://SEU_DOMINIO/api/messaging/webhooks/meta
   ```

   Use o mesmo verify token do ambiente e assine o campo `messages`.
4. Antes de liberar a função aos clientes, conclua a revisão/Advanced Access da Meta
   para `business_management`, `whatsapp_business_management` e
   `whatsapp_business_messaging`. A Meta posiciona o Embedded Signup para Solution
   Partners, Tech Providers ou Tech Partners; confirme/obtenha esse enquadramento para
   a ChegowIA antes de abrir o botão a terceiros. Para cobrar o uso WhatsApp pela
   ChegowIA, confirme também com a Meta se
   a conta usa crédito compartilhado de Solution Partner/BSP; se cada WABA pagar a
   Meta diretamente, não cobre o mesmo valor outra vez no Stripe.
5. No painel da empresa, faça um teste real do botão **Conectar meu WhatsApp** com uma
   conta Meta Business de teste. O servidor troca o código temporário por token,
   confirma a posse do WABA/número, registra números novos e assina o app nos eventos.
6. Envie mensagens de teste para validar os botões de escolha IA/humano, a entrega de
   webhook, o inbox, a troca de modo e a linha de consumo da empresa correta.

O endpoint recusa assinaturas `X-Hub-Signature-256` inválidas. O número Meta é único
na base, evitando que um webhook seja associado à empresa errada.

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

1. **Cadastro fiscal completo** e certificado A1 enviado (Painel > Fiscal). A tela lista o
   que falta.
2. **Tributação do cardápio** sem pendências — padrões da empresa resolvem a maioria; o
   restante é por produto.
3. **CSC** (identificador e token) obtido no portal da SEFAZ do estado.
4. **Homologação**: mantenha `Ambiente = Homologação` e emita vendas reais de teste. O cupom
   sai marcado como sem valor fiscal. Corrija tudo que a SEFAZ apontar.
5. Só então mude para **Produção** e ligue **emitir automaticamente**. A plataforma recusa a
   virada se faltar certificado válido ou CSC.

O que acontece quando a SEFAZ cai: a venda **não** para. A nota é assinada em contingência
offline (`tpEmis 9`), o cupom sai com o aviso "pendente de autorização" e o serviço `worker`
transmite quando o estado voltar, com espera crescente até 30 minutos. Depois de 10 tentativas
sem sucesso, sai alerta para `OPS_ALERT_EMAIL`.

Estados habilitados: MG e SP com endpoints próprios; os demais pelo SVRS. O QR Code exige a
URL do estado — habilitar um novo é uma entrada em `fiscal/nfce/sefaz-endpoints.ts` e outra em
`fiscal/nfce/qr-code.ts`.

Cancelamento vale por 30 minutos após a autorização. Passou disso, é procedimento contábil.
Toda nota rejeitada queima um número: use **Inutilizar numeração** em Painel > Notas fiscais,
senão a sequência fica com buracos que a fiscalização cobra.

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

O backup contém dump consistente do MySQL, imagens, currículos, manifesto e
checksums. A retenção padrão é 14 dias (`BACKUP_RETENTION_DAYS`). Guarde uma
segunda cópia criptografada em outro disco ou outro servidor: permanecer no
mesmo disco não protege contra perda física.

Teste a restauração periodicamente em uma máquina separada:

```bash
CONFIRM_RESTORE=YES BACKUP_DIR=/srv/chegowia/backups/AAAA... \
  /bin/sh infra/restore.sh
```

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
