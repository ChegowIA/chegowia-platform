# Revenda, assinaturas e Stripe

## Regras implementadas

- Comissão do revendedor: 30% do valor efetivamente recebido em cada fatura.
- Benefício do cliente indicado: 15% nas três primeiras mensalidades.
- O vínculo do revendedor é gravado em `ClientSubscription` e não possui endpoint
  de troca. Mudança de plano preserva `resellerId` e `referralCode`.
- A empresa e o primeiro ADMIN só são criados após `checkout.session.completed`
  com pagamento confirmado.
- Comissão só nasce em `invoice.paid`; `stripeInvoiceId` único torna o processamento
  idempotente.
- Reembolsos antes do repasse reduzem/estornam a comissão. Reembolso após repasse
  cria ajuste negativo no saldo seguinte.
- Repasse exige onboarding aprovado no Stripe Connect.

## Configuração

No `apps/api/.env`:

```env
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_..."
APP_URL="http://localhost:3000"
```

1. Ative Stripe Billing e Stripe Connect na conta da plataforma.
2. Crie um produto com preço mensal recorrente em BRL.
3. Entre como super-admin em `/super-admin/planos` e informe o `price_...`.
4. Eventos necessários:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`

### Desenvolvimento local

Não é necessário cadastrar no Dashboard um endpoint apontando para
`chegowia.com.br` enquanto a API ainda não estiver publicada. O Stripe não
consegue chamar diretamente o `localhost`; o Stripe CLI cria o túnel necessário:

```bash
stripe listen \
  --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,charge.refunded \
  --forward-to http://localhost:3001/api/billing/stripe/webhook
```

Copie o `whsec_...` exibido pelo comando para `STRIPE_WEBHOOK_SECRET` e reinicie
a API. Esse segredo pertence ao listener local e pode mudar quando um novo
listener for criado.

Para testar eventos das contas Connect, abra um segundo listener:

```bash
stripe listen \
  --events account.updated \
  --forward-connect-to http://localhost:3001/api/billing/stripe/connect-webhook
```

O segredo exibido por esse segundo processo vai em
`STRIPE_CONNECT_WEBHOOK_SECRET`.

Para validar o encaminhamento:

```bash
stripe trigger checkout.session.completed
```

O listener deve mostrar uma resposta `2xx` do endpoint local.

### Produção

Depois que a API estiver publicada em HTTPS, crie no Stripe Workbench o destino
da **conta da plataforma**, com payload `Snapshot`, e a URL pública real:

```text
https://DOMINIO-PUBLICO-DA-API/api/billing/stripe/webhook
```

Só use `https://chegowia.com.br/api/billing/stripe/webhook` se esse domínio
estiver configurado para encaminhar `/api` para a aplicação Nest. Uma página
frontend no domínio, sozinha, não cria essa rota. Copie para o ambiente de
produção o `whsec_...` gerado por esse destino do Dashboard; não reutilize o
segredo do Stripe CLI.

Crie também um destino cuja origem seja **contas conectadas**, selecione apenas
`account.updated` e use:

```text
https://DOMINIO-PUBLICO-DA-API/api/billing/stripe/connect-webhook
```

O segredo desse segundo destino vai em `STRIPE_CONNECT_WEBHOOK_SECRET`. Os
segredos não são intercambiáveis.

Use primeiro chaves `sk_test` e cartões de teste. Só altere para `sk_live` depois de
validar compra, renovação, falha, cancelamento, reembolso, comissão e repasse.

Documentação oficial:

- https://docs.stripe.com/payments/checkout-sessions
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/billing/subscriptions/coupons
- https://docs.stripe.com/connect
