import { PayoutBatchStatus } from "@prisma/client";
import { buildBillingService } from "./support/messaging-services";

/**
 * Simula o comportamento atômico do `updateMany` do banco: só a primeira
 * chamada que casar com o WHERE afeta a linha; as demais retornam count 0.
 */
function prismaWithBatch(batch: any, options?: { claimable?: boolean }) {
  let claimed = false;
  const state = { ...batch };
  return {
    state,
    payoutBatch: {
      updateMany: jest.fn().mockImplementation(({ where }: any) => {
        const matchesStatus = !where.status || state.status === where.status;
        const withinAttempts = !where.attempts || state.attempts < where.attempts.lt;
        if (claimed || !matchesStatus || !withinAttempts || options?.claimable === false) {
          return Promise.resolve({ count: 0 });
        }
        claimed = true;
        state.attempts += 1;
        return Promise.resolve({ count: 1 });
      }),
      findUnique: jest.fn().mockImplementation(() => Promise.resolve({ ...state })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(state, data);
        return Promise.resolve({ ...state });
      }),
    },
    commissionLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
}

function buildService(prisma: any) {
  const service = buildBillingService({ prisma: prisma });
  // impede que o worker de background dispare durante o teste
  service.onModuleDestroy();
  return service;
}

const baseBatch = {
  id: "lote-1",
  status: PayoutBatchStatus.PROCESSANDO,
  attempts: 0,
  amount: 250,
  currency: "brl",
  stripeTransferId: null,
  resellerId: "revendedor-1",
  reseller: { stripeAccountId: null },
  commissions: [{ id: "c1" }],
};

describe("concorrência no repasse ao revendedor", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  afterAll(() => { process.env.STRIPE_SECRET_KEY = originalKey; });

  it("só um worker reivindica o lote; o segundo não executa a transferência", async () => {
    const prisma = prismaWithBatch(baseBatch);
    const service = buildService(prisma);
    const execute = (service as any).executePayoutBatch.bind(service);

    // Sem conta Stripe configurada, o vencedor encerra o lote; o perdedor
    // precisa sair sem tentar transferir.
    const [first, second] = await Promise.all([
      execute("lote-1", true).catch(() => "erro"),
      execute("lote-1", true).catch(() => "erro"),
    ]);

    const claims = prisma.payoutBatch.updateMany.mock.results.filter(
      (r: any) => r.value && typeof r.value.then === "function",
    );
    expect(claims).toHaveLength(2); // as duas tentaram
    const counts = await Promise.all(claims.map((r: any) => r.value));
    expect(counts.filter((c: any) => c.count === 1)).toHaveLength(1); // só uma venceu
    expect([first, second]).toContain(null);
  });

  it("incrementa attempts uma única vez por execução", async () => {
    const prisma = prismaWithBatch(baseBatch);
    const service = buildService(prisma);

    await (service as any).executePayoutBatch("lote-1", true).catch(() => undefined);

    expect(prisma.state.attempts).toBe(1);
  });

  it("libera o lote preso em PROCESSANDO com tentativas esgotadas", async () => {
    // attempts no teto: o claim não casa, mas o lote não pode ficar travado
    const prisma = prismaWithBatch({ ...baseBatch, attempts: 10 });
    const service = buildService(prisma);

    const result = await (service as any).executePayoutBatch("lote-1", true).catch(() => "erro");

    expect(result).toBeNull();
    // failPayoutBatch roda dentro de $transaction, devolvendo as comissões
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
