# Revenda, assinaturas e cobrança

O provedor de cobrança é escolhido por `BILLING_PROVIDER` (`ASAAS` ou `STRIPE`).
A escolha vale para **contratações novas**: uma assinatura já criada na Stripe
continua sendo cobrada, gerenciada e cancelada por ela mesmo depois da troca —
migrar o meio de pagamento de quem já paga exigiria pedir o cartão de novo sem
que o cliente tenha solicitado.

## Regras que não dependem do provedor

- Comissão do revendedor: 30% do valor efetivamente recebido em cada cobrança.
- Benefício do cliente indicado: 15% nas três primeiras mensalidades.
- O vínculo do revendedor é gravado em `ClientSubscription` e não possui endpoint
  de troca. Mudança de plano preserva `resellerId` e `referralCode`.
- A empresa e o primeiro ADMIN só são criados após o pagamento confirmado.
- A comissão nasce **pendente** e só fica disponível após `COMMISSION_HOLD_DAYS`
  (padrão 7), prazo que cobre estorno e contestação. Por isso não usamos split
  automático, que repassaria no ato.
- Estorno ou chargeback marca a comissão como `ESTORNADA`.
- Repasse mínimo de R$ 10,00 e um lote em processamento por vez.
- O consumo variável (IA e WhatsApp) do período de teste nunca é faturado.

## Asaas (provedor atual)

### Variáveis

```env
BILLING_PROVIDER=ASAAS
ASAAS_API_KEY=$aact_prod_...        # a chave carrega o ambiente
ASAAS_WEBHOOK_TOKEN=...             # mínimo 20 caracteres
ASAAS_SUBACCOUNT_ENCRYPTION_KEY=    # opcional, 32 bytes em base64 ou hex
COMMISSION_HOLD_DAYS=7
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
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
     `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_REVERSED`,
     `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`
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
- **Consumo variável**: somado ao valor da cobrança em aberto da assinatura, na
  mesma fatura da mensalidade. Um lançamento que não coube no ciclo continua
  pendente e entra no seguinte, nunca some.
- **Inadimplência**: `PAYMENT_OVERDUE` marca `INADIMPLENTE`.
- **Cancelamento**: `POST /billing/company/cancel` encerra as cobranças futuras.
  O acesso continua até o fim do período já pago.

### Repasse ao revendedor

O revendedor abre uma **subconta Asaas** pela tela `/revendedor/financeiro`
(endereço, bairro, CEP e faturamento declarado; pessoa física precisa também da
data de nascimento). A subconta devolve um `walletId`, que endereça as
transferências, e uma `apiKey` que só existe naquele instante — ela é guardada
cifrada quando `ASAAS_SUBACCOUNT_ENCRYPTION_KEY` está configurada, e descartada
caso contrário. Perdê-la não impede o repasse: a transferência sai da conta raiz.

A transferência entre a conta raiz e a subconta é gratuita e imediata, o que
permite manter a carência de 7 dias sem custo.

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
- https://docs.asaas.com/reference/criar-subconta
- https://docs.asaas.com/reference/transferir-para-conta-asaas
- https://docs.stripe.com/billing/subscriptions/webhooks
