import { ResellersService } from "../src/resellers/resellers.service";

describe("extrato profissional da comissão do revendedor", () => {
  function build() {
    const now = new Date();
    const profile = { id: "rev-1", userId: "user-1", isActive: true, code: "ANA1234", user: { name: "Ana", email: "ana@exemplo.com" } };
    const commissions = [
      {
        id: "available", status: "DISPONIVEL", commissionAmount: 30, grossAmount: 100, commissionRate: 0.3,
        settledAt: now, availableAt: now, holdReason: null,
        subscription: { company: { name: "Pizzaria" }, plan: { name: "Profissional" } },
      },
      {
        id: "settling", status: "PENDENTE", commissionAmount: 30, grossAmount: 100, commissionRate: 0.3,
        settledAt: null, availableAt: null, holdReason: "AGUARDANDO_COMPENSACAO_ASAAS",
        subscription: { company: { name: "Hamburgueria" }, plan: { name: "Profissional" } },
      },
      {
        id: "processing", status: "PROCESSANDO", commissionAmount: 30, grossAmount: 100, commissionRate: 0.3,
        settledAt: now, availableAt: now, holdReason: null,
        subscription: { company: { name: "Padaria" }, plan: { name: "Profissional" } },
      },
      {
        id: "adjustment", status: "DISPONIVEL", commissionAmount: -15, grossAmount: -50, commissionRate: 0.3,
        settledAt: now, availableAt: now, holdReason: "AJUSTE_DE_ESTORNO",
        subscription: { company: { name: "Loja cancelada" }, plan: { name: "Profissional" } },
      },
    ];
    const prisma = {
      resellerProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      commissionLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue(commissions),
      },
      clientSubscription: { count: jest.fn().mockResolvedValue(2) },
      resellerProspect: { count: jest.fn().mockResolvedValue(3) },
      salesLead: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ResellersService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    return { service, prisma };
  }

  it("separa saldo sacável, compensação e ajuste sem prometer saque antes do crédito", async () => {
    const { service } = build();

    const dashboard: any = await service.dashboard("user-1");

    expect(dashboard.balances).toMatchObject({ available: 15, pendingSettlement: 30, processing: 30, paid: 0 });
    expect(dashboard.commissionPolicy).toMatchObject({ trialDays: 7, commissionRatePercent: 30 });
    expect(dashboard.commissions.find((item: any) => item.id === "settling").lifecycle).toMatchObject({
      code: "EM_COMPENSACAO",
      label: "Em compensação",
    });
    expect(dashboard.commissions.find((item: any) => item.id === "adjustment").lifecycle).toMatchObject({
      code: "AJUSTE",
      label: "Ajuste de estorno",
    });
  });

  it("na visão de suporte calcula o extrato sem alterar o saldo do parceiro", async () => {
    const { service, prisma } = build();

    await service.dashboard("user-1", true, true);

    expect(prisma.commissionLedger.updateMany).not.toHaveBeenCalled();
  });

  it("na visão de suporte não consulta a fila coletiva de leads", async () => {
    const { service, prisma } = build();

    await service.availableLeads("user-1", true, true);

    expect(prisma.salesLead.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.salesLead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { resellerId: "rev-1" },
    }));
  });
});
