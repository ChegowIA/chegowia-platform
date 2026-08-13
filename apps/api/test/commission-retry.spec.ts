import { CommissionStatus } from "@prisma/client";
import { buildBillingService } from "./support/messaging-services";

/**
 * A comissão do revendedor é lançada *depois* do commit da transação que cria a
 * empresa. Se o processo caísse nesse intervalo, o reprocessamento do evento
 * Stripe encontrava `application.companyId` já preenchido e retornava cedo — os
 * 30% do revendedor sumiam em definitivo, sem erro em lugar nenhum.
 */
describe("comissão do revendedor no reprocessamento do checkout", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  afterAll(() => { process.env.STRIPE_SECRET_KEY = originalKey; });

  const invoice = { id: "in_1", status: "paid", amount_paid: 19900, currency: "brl", subscription: "sub_1" };

  function build() {
    const commissionLedger = { upsert: jest.fn().mockResolvedValue({}) };
    const prisma = {
      clientApplication: {
        findUnique: jest.fn().mockResolvedValue({
          id: "app-1",
          companyId: "empresa-1", // já provisionada: é o caminho do retry
          plan: { slug: "pro" },
        }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-1" }) },
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: "assinatura-1",
          resellerId: "revendedor-1",
          reseller: { isActive: true, commissionRate: 0.3 },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      commissionLedger,
    };
    const auth = { sendVerificationForUser: jest.fn().mockResolvedValue(undefined) };
    const service = buildBillingService({ prisma: prisma, auth: auth });
    service.onModuleDestroy();
    (service as any).stripe = {
      subscriptions: { retrieve: jest.fn().mockResolvedValue({ latest_invoice: invoice }) },
    };
    return { service, prisma, commissionLedger, auth };
  }

  const session = {
    payment_status: "paid",
    metadata: { applicationId: "app-1" },
    subscription: "sub_1",
  } as never;

  it("registra a comissão mesmo quando a empresa já havia sido criada", async () => {
    const { service, commissionLedger } = build();

    await (service as any).completeCheckout(session);

    expect(commissionLedger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeInvoiceId: "in_1" },
        create: expect.objectContaining({
          resellerId: "revendedor-1",
          grossAmount: 199,
          commissionAmount: 59.7,
        }),
      }),
    );
  });

  it("repetir o evento não duplica o lançamento — o upsert não altera o existente", async () => {
    const { service, commissionLedger } = build();

    await (service as any).completeCheckout(session);
    await (service as any).completeCheckout(session);

    expect(commissionLedger.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of commissionLedger.upsert.mock.calls) {
      expect(args.update).toEqual({});
    }
  });

  it("sem assinatura na sessão não tenta lançar comissão", async () => {
    const { service, commissionLedger } = build();

    await (service as any).completeCheckout({ ...(session as any), subscription: null });

    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("não lança comissão quando o revendedor está inativo", async () => {
    const { service, prisma, commissionLedger } = build();
    prisma.clientSubscription.findUnique = jest.fn().mockResolvedValue({
      id: "assinatura-1",
      resellerId: "revendedor-1",
      reseller: { isActive: false, commissionRate: 0.3 },
    });

    await (service as any).completeCheckout(session);

    expect(commissionLedger.upsert).not.toHaveBeenCalled();
  });

  it("mantém o reenvio da verificação de e-mail no retry", async () => {
    const { service, auth } = build();

    await (service as any).completeCheckout(session);

    expect(auth.sendVerificationForUser).toHaveBeenCalledWith("admin-1");
  });

  it("respeita a carência antes de liberar o valor", async () => {
    process.env.STRIPE_COMMISSION_HOLD_DAYS = "7";
    const { service, commissionLedger } = build();

    await (service as any).completeCheckout(session);

    const [args] = commissionLedger.upsert.mock.calls[0];
    expect(args.create.status).toBe(CommissionStatus.PENDENTE);
  });
});
