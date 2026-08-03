import { PayoutBatchStatus, StripeEventStatus } from "@prisma/client";
import { BillingService } from "../src/billing/billing.service";

/**
 * Evento Stripe com 10 tentativas some da fila e lote de repasse FALHOU é
 * terminal — nos dois casos o dinheiro ficou pendurado e a única pista era uma
 * linha de log. O alerta precisa sair exatamente uma vez por item, mesmo com o
 * worker rodando a cada 5 segundos.
 */
describe("alerta de dead-letter da fila de cobrança", () => {
  function build(options: { eventos?: any[]; lotes?: any[] } = {}) {
    const eventos = options.eventos ?? [];
    const lotes = options.lotes ?? [];
    // Reproduz o claim atômico: só a primeira chamada com alertedAt null pega.
    const alertados = new Set<string>();
    const claim = jest.fn(({ where }: any) => {
      if (alertados.has(where.id)) return Promise.resolve({ count: 0 });
      alertados.add(where.id);
      return Promise.resolve({ count: 1 });
    });
    const prisma = {
      stripeEvent: {
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(eventos.filter((item) => !alertados.has(item.id))),
        ),
        updateMany: claim,
      },
      payoutBatch: {
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(lotes.filter((item) => !alertados.has(item.id))),
        ),
        updateMany: claim,
      },
    };
    const mail = { sendOperationsAlert: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingService(prisma as never, {} as never, {} as never, {} as never, mail as never);
    service.onModuleDestroy();
    return { service, prisma, mail };
  }

  const eventoMorto = {
    id: "evt_1",
    type: "checkout.session.completed",
    attempts: 10,
    lastError: "Falha temporária ao processar o evento.",
    status: StripeEventStatus.FALHOU,
  };

  const loteMorto = {
    id: "lote-1",
    resellerId: "revendedor-1",
    amount: 250,
    currency: "brl",
    failureReason: "Transferência recusada.",
    status: PayoutBatchStatus.FALHOU,
  };

  it("avisa a operação quando um evento Stripe esgota as tentativas", async () => {
    const { service, mail } = build({ eventos: [eventoMorto] });

    await (service as any).alertDeadLetters();

    expect(mail.sendOperationsAlert).toHaveBeenCalledTimes(1);
    const [assunto, linhas] = mail.sendOperationsAlert.mock.calls[0];
    expect(assunto).toContain("Evento Stripe");
    expect(linhas.join("\n")).toContain("evt_1");
    expect(linhas.join("\n")).toContain("checkout.session.completed");
  });

  it("filtra por status, tentativas esgotadas e ausência de aviso anterior", async () => {
    const { service, prisma } = build({ eventos: [eventoMorto] });

    await (service as any).alertDeadLetters();

    expect(prisma.stripeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: StripeEventStatus.FALHOU,
          attempts: { gte: 10 },
          alertedAt: null,
        },
      }),
    );
  });

  it("não repete o alerta nas rodadas seguintes do worker", async () => {
    const { service, mail } = build({ eventos: [eventoMorto] });

    await (service as any).alertDeadLetters();
    await (service as any).alertDeadLetters();
    await (service as any).alertDeadLetters();

    expect(mail.sendOperationsAlert).toHaveBeenCalledTimes(1);
  });

  it("com duas réplicas na mesma rodada, só quem reivindicou envia", async () => {
    const { service, mail } = build({ eventos: [eventoMorto] });

    await Promise.all([
      (service as any).alertDeadLetters(),
      (service as any).alertDeadLetters(),
    ]);

    expect(mail.sendOperationsAlert).toHaveBeenCalledTimes(1);
  });

  it("avisa sobre repasse encerrado sem confirmação, sem exigir esgotamento", async () => {
    const { service, prisma, mail } = build({ lotes: [loteMorto] });

    await (service as any).alertDeadLetters();

    expect(prisma.payoutBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PayoutBatchStatus.FALHOU, alertedAt: null },
      }),
    );
    const [assunto, linhas] = mail.sendOperationsAlert.mock.calls[0];
    expect(assunto).toContain("Repasse");
    expect(linhas.join("\n")).toContain("revendedor-1");
  });

  it("fila limpa não gera e-mail nenhum", async () => {
    const { service, mail } = build();

    await (service as any).alertDeadLetters();

    expect(mail.sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("falha no envio não derruba o worker", async () => {
    const { service, mail } = build({ eventos: [eventoMorto] });
    mail.sendOperationsAlert.mockRejectedValue(new Error("SMTP fora do ar"));

    await expect((service as any).alertDeadLetters()).resolves.toBeUndefined();
  });
});
