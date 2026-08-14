# Revenda, assinaturas e cobrança

O provedor de cobrança é escolhido por `BILLING_PROVIDER` (`ASAAS` ou `STRIPE`).
A escolha vale para **contratações novas**: uma assinatura já criada na Stripe
continua sendo cobrada, gerenciada e cancelada por ela mesmo depois da troca —
migrar o meio de pagamento de quem já paga exigiria pedir o cartão de novo sem
que o cliente tenha solicitado.

## Regras que não dependem do provedor

- Comissão do revendedor: 30% da mensalidade do plano efetivamente recebida em
  cada cobrança. Consumo de IA e WhatsApp não entra na base de comissão.
- Benefício do cliente indicado: 15% nas três primeiras mensalidades.
- O vínculo do revendedor é gravado em `ClientSubscription` e não possui endpoint
  de troca. Mudança de plano preserva `resellerId` e `referralCode`.
- A empresa e o primeiro ADMIN só são criados após o pagamento confirmado.
- A comissão só nasce depois dos sete dias completos de teste e começa
  **pendente**. Ela fica disponível quando o Asaas informa que recebeu o valor
  na conta raiz ou que uma antecipação automática elegível foi creditada.
  `ASAAS_COMMISSION_POST_RECEIPT_HOLD_DAYS`, se configurada, acrescenta uma
  reserva opcional após esse crédito. Não usamos split automático, que
  repassaria antes dessa conciliação.
- Estorno final marca a comissão como `ESTORNADA`; chargeback suspende o saldo
  até a decisão do Asaas.
- Repasse mínimo de R$ 10,00 e um lote em processamento por vez.
- O consumo variável (IA e WhatsApp) do período de teste entra na fatura de
  ativação de quem assina; quem não assina não paga nada. A promessa está escrita
  nas páginas públicas de venda, então mudar essa regra exige mudar aquele texto
  junto — há teste que barra a divergência.

## Asaas (provedor atual)

### Variáveis

```env
BILLING_PROVIDER=ASAAS
ASAAS_API_KEY=$aact_prod_...        # a chave carrega o ambiente
ASAAS_WEBHOOK_TOKEN=...             # mínimo 20 caracteres
ASAAS_SUBACCOUNT_ENCRYPTION_KEY=    # opcional, 32 bytes em base64 ou hex
ASAAS_COMMISSION_POST_RECEIPT_HOLD_DAYS=0 # reserva opcional após o crédito
ASAAS_USAGE_MIN_CHARGE=5              # mínimo para emitir cobrança de consumo
API_PUBLIC_URL=https://DOMINIO-DA-API
```

Não existe variável de URL: `$aact_prod_` responde apenas em `api.asaas.com` e
`$aact_hmlg_` apenas em `api-sandbox.asaas.com`. Apontar para o host errado
devolve 401, que é a confusão mais comum ao configurar. Subir com chave de
homologação marcando `NODE_ENV=production` é recusado no boot, a menos que
`ALLOW_ASAAS_SANDBOX_IN_PRODUCTION=true`.

### Passos na conta Asaas

1. Crie a conta em https://www.asaas.com e conclua a verificação da empresa.
2. Em **Integrações → API**, gere a chave de produção (`$aact_prod_...`).
3. Em **Integrações → Webhooks**, crie um webhook com:
   - URL: `https://DOMINIO-DA-API/api/billing/asaas/webhook`
   - Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - Versão da API: v3, envio com fila ativada
   - Eventos, em Cobranças: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
     `PAYMENT_RECEIVED_IN_CASH`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`,
     `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_RECEIVED_IN_CASH_UNDONE`,
     `PAYMENT_DELETED`
   - Eventos, em Assinaturas: `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`
   - Eventos, em Antecipações: `RECEIVABLE_ANTICIPATION_CREDITED`
   - Eventos, em Transferências: `TRANSFER_DONE`, `TRANSFER_FAILED`,
     `TRANSFER_CANCELLED`

   Os nomes são comparados como string exata: um evento marcado no painel com
   nome que o código não conhece chega e é descartado em silêncio. As etapas
   intermediárias (`PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_CHARGEBACK_DISPUTE`,
   `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`) não precisam ser marcadas: todas
   terminam em um dos eventos acima.
4. Habilite os meios que quiser aceitar (Pix, boleto e cartão). O cliente escolhe
   na própria fatura; não guardamos cartão.

O token do webhook é a **única** prova de origem do callback — o Asaas não assina
o corpo como a Stripe. Um token curto ou compartilhado equivale a deixar qualquer
um marcar assinatura como paga.

### Como o fluxo funciona

- **Ativação**: `POST /billing/company/checkout` cria o cliente (CNPJ da empresa
  é obrigatório), a assinatura mensal e devolve o link da primeira cobrança. Se
  já houver cobrança em aberto, o mesmo link é reaproveitado em vez de gerar
  outra a cada clique.
- **Liberação de acesso**: só pelo webhook. `PAYMENT_CONFIRMED` e
  `PAYMENT_RECEIVED` ativam; o evento é gravado na fila (`StripeEvent`, com
  `provider = ASAAS`) e reprocessado até dar certo, de forma idempotente.
- **Antecipação automática de cartão**: quando o Asaas enviar
  `RECEIVABLE_ANTICIPATION_CREDITED`, a API busca a cobrança relacionada e
  libera a comissão elegível sem esperar o ciclo normal de recebimento. Segundo
  a documentação do Asaas, o valor antecipado é creditado em até dois dias úteis;
  isso vale apenas para recebíveis de cartão elegíveis, não para Pix, boleto ou
  uma promessa genérica de liquidação. Se esse webhook se perder, a rotina de
  conciliação consulta periodicamente a antecipação creditada da cobrança; a
  entrega do webhook continua sendo o caminho mais rápido.
- **Consumo variável**: **nunca vira cobrança separada.** É somado à cobrança da
  mensalidade, uma fatura só com o valor total. Sem mensalidade em aberto onde
  somar, o consumo continua `PENDENTE` e entra na cobrança seguinte — acumular é
  o comportamento correto, não uma falha.

  A fatura de ativação pós-teste também sai com o total: mensalidade mais todo o
  consumo faturável acumulado. O valor da assinatura no Asaas fica intocado,
  senão o acréscimo se repetiria todo mês.

  Consumo marcado com `trialCoveredAt` é o do período de teste. Ele **é cobrado de
  quem assina e perdoado de quem desiste**: a rotina mensal o ignora, e a fatura
  de ativação o inclui. Quem nunca ativa nunca paga — a cortesia é a desistência,
  não o teste.

- **Inadimplência**: `PAYMENT_OVERDUE` marca `INADIMPLENTE`, e a partir daí o
  painel bloqueia na hora (sem carência). A rotina de fundo também considera
  vencida a cobrança em aberto cujo vencimento já passou, sem esperar o rótulo
  `OVERDUE` — ele só aparece na virada do dia do Asaas, e o bloqueio não deve
  depender da agenda deles. A rotina reconsulta em até um minuto e a consulta
  do painel revalida imediatamente. O dia do vencimento em si não bloqueia: vencer é ter
  passado do prazo, não chegar nele. O `currentPeriodEnd` não participa do
  bloqueio — quem decide é o status. Uma rotina de fundo também confere no Asaas
  as assinaturas já fora do período pago, para o bloqueio não depender de o
  webhook estar ativo.
- **Dinheiro que volta**: estorno, chargeback e desfazimento de recebimento em
  dinheiro estornam a comissão e marcam `INADIMPLENTE`.
- **Cobrança apagada no painel** (`PAYMENT_DELETED`): o consumo que estava nela
  volta para a fila e entra na cobrança seguinte. Sem isso ficaria marcado como
  faturado apontando para uma cobrança inexistente — perda silenciosa.
- **Cancelamento**: `POST /billing/company/cancel` encerra as cobranças futuras.
  O acesso continua até o fim do período já pago.

### Repasse ao revendedor

O revendedor abre uma **subconta Asaas** pela tela `/revendedor/financeiro`
(endereço, bairro, CEP e faturamento declarado; pessoa física precisa também da
data de nascimento). A subconta devolve um `walletId`, que endereça as
transferências, e uma `apiKey` que só existe naquele instante — ela é guardada
cifrada quando `ASAAS_SUBACCOUNT_ENCRYPTION_KEY` está configurada, e descartada
caso contrário. Perdê-la não impede o repasse: a transferência sai da conta raiz.

A transferência entre a conta raiz e a subconta costuma ser rápida, mas o
sistema só marca o lote como pago depois de `TRANSFER_DONE`. Ao solicitar o
repasse, o revendedor vê e recebe por e-mail o prazo operacional de **até 5 dias
úteis**; se o Asaas concluir antes, o painel é atualizado antes do prazo.

Como a API do Asaas não aceita chave de idempotência, duas proteções foram
adicionadas: antes de criar a subconta, uma falha é seguida de consulta por
CPF/CNPJ; antes de transferir, consultamos pela `externalReference` (`payout-<id
do lote>`). Sem isso, uma resposta perdida pagaria o revendedor duas vezes.

## Stripe (legado)

Continua ativo enquanto houver assinatura criada por ele. As chaves só são
exigidas no boot quando `BILLING_PROVIDER` não é `ASAAS` — ou quando
`STRIPE_SECRET_KEY` está preenchida, caso em que o formato segue sendo conferido.

```env
STRIPE_SECRET_KEY="sk_live_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_..."
```

Eventos do destino da plataforma
(`https://DOMINIO-DA-API/api/billing/stripe/webhook`):
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `charge.refunded`.

Destino das contas conectadas
(`https://DOMINIO-DA-API/api/billing/stripe/connect-webhook`): apenas
`account.updated`. Os segredos não são intercambiáveis.

Em desenvolvimento, o Stripe CLI cria o túnel:

```bash
stripe listen \
  --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,charge.refunded \
  --forward-to http://localhost:3001/api/billing/stripe/webhook
```

## Referências

- https://docs.asaas.com/reference/criar-nova-assinatura
- https://docs.asaas.com/docs/webhook-para-cobrancas
- https://docs.asaas.com/docs/webhook-para-antecipacoes
- https://docs.asaas.com/reference/listar-antecipacoes
- https://docs.asaas.com/changelog/endpoint-para-configurar-antecipação-automática-de-cobranças-de-cartão-de-crédito
- https://docs.asaas.com/reference/criar-subconta
- https://docs.asaas.com/reference/transferir-para-conta-asaas
- https://docs.stripe.com/billing/subscriptions/webhooks
