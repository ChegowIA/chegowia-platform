# Publicação do ChegowIA

## Onde a produção roda hoje

Leia isto antes de qualquer comando deste documento, porque ele descreve **duas**
implantações possíveis e a maior parte dele é sobre a segunda.

**A produção atual usa plataformas gerenciadas:**

| Peça | Onde | Como se mexe |
|---|---|---|
| API (e worker) | Render, container com disco em `/data` | Deploy por push na branch conectada, ou *Manual Deploy* no painel |
| Web | Vercel | Deploy automático a cada push |
| MySQL | Railway, exposto pelo proxy TCP público | Painel do Railway |

Consequências que já produziram erro na prática:

- **Não existe host para entrar por SSH.** O shell que o Render oferece é *dentro*
  do container: `/app`, sem `git`, sem `docker` e sem este repositório. Os comandos
  de `docker compose` deste documento não rodam ali — e não é falta de permissão,
  é que aquela máquina não é o host.
- **As migrations rodam sozinhas no boot.** O entrypoint executa
  `prisma migrate deploy` antes de subir o processo, então publicar já migra.
- **Serviço do Render com disco anexado não escala além de uma instância.** É o que
  garante um único worker de cobrança, sem duplicar job.
- **O disco `/data` é persistente**, então imagem de produto e documento sobrevivem
  ao deploy. O que ele não tem é backup nosso: ver a seção 8.

**A implantação em servidor próprio** (`compose.production.yml`, com MySQL, Caddy
e ClamAV em containers) continua suportada e é o que as seções 1, 6 e 9 descrevem.
Os scripts de `infra/` detectam qual das duas está em uso.

## 1. Servidor e DNS (implantação em servidor próprio)

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

O canal de WhatsApp é atendido pelo Gupshup, BSP homologado pela Meta. A
ChegowIA não fala com a Cloud API diretamente: o Gupshup faz a ponte com a Meta,
sem exigir App Review próprio da ChegowIA.

**Padrão para números que já usam WhatsApp Business:** use **coexistência**.
Ela mantém o mesmo número no WhatsApp Business App e na Central da ChegowIA. A
mensagem digitada pelo celular entra na Central como atendimento humano; a
mensagem enviada pela Central aparece no aplicativo. Só escolha o onboarding
padrão/exclusivo para um número novo que não precisa do app.

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
   exibe. Prefira o formato **Meta (v3)**. Para coexistência, habilite também os
   eventos **COEXISTENCE** e **ACCOUNT**, além de mensagens e `billing-event`.
4. Inicie o onboarding do número. No passo do Facebook, escolha **Connect a
   WhatsApp Business app** / **usar WhatsApp Business existente**. Copie o link
   de **Direct Facebook Registration** e pare — não conclua você.
5. Em **Super-admin → Empresas → [empresa]**, preencha nome do aplicativo, App ID
   e o link de cadastro.
6. A empresa conclui pelo botão **Conectar meu WhatsApp**, com o Facebook dela,
   e confirma pelo QR code ou código de acesso dentro do **WhatsApp Business
   App**. Você nunca acessa a conta do cliente. Ao voltar, ela clica em
   **Já concluí**: isso avisa a equipe por e-mail e no super-admin ("O cliente
   concluiu o cadastro: falta ativar"), e o painel dela passa a mostrar
   "aguardando ativação".
7. Confira no Gupshup que o app está **Live**. Só então preencha o **número**
   (e o App ID, obrigatório para ativar) no card e salve, com o modo
   **Manter WhatsApp Business App**. O painel da empresa vira "Conectado" sozinho.
   Preencher o número antes do Live mostraria "Conectado" sem o número estar no
   ar, e mensagens chegando a um canal inativo são descartadas.

Só o superadmin vincula aplicativo a uma empresa. O sistema recusa um app (nome
ou App ID) que já pertença a outra empresa ou ao WhatsApp institucional da
ChegowIA: o webhook procura primeiro nas empresas, então esse vínculo desviaria
as conversas e permitiria enviar em nome do outro número.

Não migre automaticamente um número que já está exclusivo na API: a volta para
coexistência exige uma nova conexão feita pelo dono do número no aplicativo. A
operação deve ser agendada e confirmada por ele; desconectar o canal atual antes
da nova conexão estar pronta pode interromper o atendimento.

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

### Operação de demonstração descartável

Para testar papéis de administrador, atendimento, cozinha, motoboy e garçom
sem criar cobrança no Asaas ou Stripe, abra o **Shell** do serviço de API no
Render e rode:

```sh
DEMO_ADMIN_EMAIL='seu-email+demo@exemplo.com' node apps/api/prisma/setup-demo-company.js --allow-production
```

O comando cria a **Pizzaria Exemplo ChegowIA**, um cardápio com tamanhos e
sabores de pizza configuráveis, mesas, caixa e um pedido em rota. Ele imprime
uma senha forte para as contas de teste; guarde-a antes de fechar o Shell. O
e-mail informado será o ADMIN e receberá o código MFA normalmente. Use um
alias/caixa de e-mail sua que **ainda não tenha conta na ChegowIA**, pois a
operação demo é apagada por completo no cleanup. As demais contas usam o
domínio reservado `@demo.chegowia.invalid`. A empresa fica marcada como
`isTestOnly`, portanto continua oculta do catálogo público geral.

Há uma exceção deliberadamente estreita para a operação
`operacao-demo-chegowia`: ela pode aparecer **somente** para a conta
`thiagolpssouza@gmail.com`, quando essa pessoa estiver autenticada e tiver um
endereço salvo com CEP válido dentro da cidade/área atendida e do raio real da
loja. A API compara primeiro a proximidade aproximada dos CEPs e confirma com
a rota por ruas; URL, parâmetro de navegador ou outro e-mail não liberam a
loja. Todas as demais empresas `isTestOnly` seguem invisíveis.

Não existe rota web/API para criar esse tipo de empresa, assinatura sem
cobrança ou e-mails reservados: somente este script, executado com acesso ao
Shell e ao banco, pode provisioná-los.

Para apagar apenas essa operação depois, primeiro confira a prévia:

```sh
node apps/api/prisma/remove-demo-company.js
```

Em seguida, copie o comando que o próprio script mostrar. Ele exige o nome
exato do banco conectado e `--allow-production`, por exemplo:

```sh
node apps/api/prisma/remove-demo-company.js --confirmar=chegowia --allow-production
```

Não use `reset-data.js` para isso: ele é uma limpeza global de banco, enquanto
o comando acima remove somente a empresa demo e as contas reservadas dela.

### CEP operacional e distância

CEP de oito dígitos é obrigatório para novos endereços de clientes, empresas e
contratações. Registros antigos permanecem preservados, mas precisam receber o
CEP antes de uma nova edição ou de aceitar entrega. A vitrine usa o centro
aproximado do CEP como triagem rápida; o checkout ainda geocodifica o endereço
completo e calcula a rota de carro, que é a decisão definitiva para taxa e
raio de entrega.

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
- A Central de Prospecção roda junto dos jobs do `worker` (ou `all`) e envia
  pelo WhatsApp institucional do Gupshup. O antigo serviço `outreach-worker`
  (número QR) foi aposentado: exclua-o; com `APP_ROLE=outreach-worker` o
  processo se recusa a subir. Veja [CENTRAL_PROSPECCAO.md](CENTRAL_PROSPECCAO.md).

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

### O que o backup cobre, e o que não cobre

O dump do MySQL carrega o que é insubstituível: XML de NFC-e, protocolo de
autorização e o próprio certificado A1 (cifrado no banco, nunca em disco). É ele
que atende a guarda obrigatória de cinco anos, além de todo o dado de negócio.

Fora do banco ficam apenas os arquivos enviados — imagem de produto, logo,
documento. Eles moram no disco de quem serve a API e são reenviáveis pelo
lojista; nota fiscal não é. Quando o backup roda onde esse disco está, eles
entram no `files.tar.gz`; quando roda de fora, o script avisa e a cobertura fica
com o snapshot de disco do provedor.

### Na produção atual (banco no Railway)

O banco é alcançável pela rede, então o dump sai de qualquer máquina — a sua
inclusive. `infra/backup.sh` detecta isso pela presença de `DATABASE_URL`:

```bash
DATABASE_URL='mysql://usuario:senha@host.proxy.rlwy.net:PORTA/banco' \
  BACKUP_ROOT=~/chegowia-backups \
  BACKUP_ALLOW_LOCAL_ONLY=true \
  sh infra/backup.sh
```

O `mysqldump` vem da imagem oficial `mysql:8.4` via docker quando ela está
disponível, e não do binário do sistema. O motivo é concreto: um `mysqldump` do
MariaDB recusa opções do MySQL 8 e derruba o dump por incompatibilidade de
cliente, não por problema no banco.

A conexão exige TLS por padrão (`--ssl-mode=REQUIRED`), porque o dump atravessa a
internet com endereço de cliente, CPF e CNPJ dentro. Isso cifra o tráfego, mas
não valida a autoridade certificadora — protege contra escuta passiva, não contra
um intermediário ativo. Se o banco recusar conexão cifrada, `BACKUP_REQUIRE_TLS=false`
libera, sabendo o que isso significa.

Para automatizar sem depender da sua máquina, o caminho é um **Cron Job** no
provedor rodando esse mesmo comando. Ele precisa de uma imagem com cliente MySQL
e a `DATABASE_URL` como segredo — a imagem da API não serve, ela não tem cliente
MySQL de propósito.

Confira também, no painel do Railway, se o volume do MySQL tem snapshot
automático no seu plano. Ter os dois é o certo: o snapshot do provedor é rápido
para acidente operacional, e o seu dump é o que permite restaurar em outro
provedor se a conta for perdida.

### Em servidor próprio

Agende diariamente:

```cron
17 3 * * * cd /caminho/chegowia && /bin/sh infra/backup.sh >> /var/log/chegowia-backup.log 2>&1
```

Ali o banco não publica porta, então o dump sai por `docker compose exec` — e
isso exige rodar **no host**, não dentro do container da API, que não tem docker.

### A cópia precisa sair de onde está

Backup que mora no mesmo disco do banco não é backup. Disco morto, incêndio ou
conta encerrada no provedor levam o dado e a cópia juntos — e aqui há nota fiscal
autorizada, com guarda obrigatória de cinco anos.

Configure um destino no ambiente ou em `.env.production`:

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

O diretório do backup traz o dump, o manifesto (que registra o modo usado e se os
arquivos entraram) e os checksums. A retenção padrão é 14 dias
(`BACKUP_RETENTION_DAYS`).

**Restaure uma vez antes de precisar.** Backup que ninguém restaurou é suposição,
não cópia de segurança.

Em servidor próprio:

```bash
CONFIRM_RESTORE=YES BACKUP_DIR=/srv/chegowia/backups/AAAA... \
  /bin/sh infra/restore.sh
```

Com banco remoto, aponte a `DATABASE_URL` para um banco **descartável** e confira
a contagem de tabelas e registros contra a origem:

```bash
CONFIRM_RESTORE=YES CONFIRM_RESTORE_REMOTO=YES \
  BACKUP_DIR=~/chegowia-backups/AAAA... \
  DATABASE_URL='mysql://usuario:senha@host:PORTA/banco_de_teste' \
  sh infra/restore.sh
```

A confirmação dupla existe porque, em modo remoto, o script não tem como parar a
aplicação — quem faz isso é você, no painel do provedor. Restaurar com a API no ar
deixa a aplicação lendo um banco recriado por baixo.

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

### Em plataforma gerenciada (produção atual)

Não há comando a rodar no servidor. A sequência é:

1. `git push` na branch conectada — ou *Manual Deploy → Deploy latest commit* no
   painel do Render, se o deploy automático estiver desligado.
2. Acompanhe **Events** no Render. As migrations rodam no boot, então o log do
   deploy mostra `Aplicando migrações pendentes...` antes de a API subir.
3. Confira de fora:

```bash
WEB_URL=https://SEU-DOMINIO API_URL=https://SUA-API/api sh infra/check-production.sh
```

Rollback é o *Rollback* do painel do Render para o deploy anterior — mas só se as
migrations forem compatíveis. Migration que apagou coluna não volta por rollback
de imagem; ali é restauração de backup e janela de manutenção.

### Em servidor próprio

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
