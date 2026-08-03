import { ReportsService } from "../src/reports/reports.service";
import { tenantContext } from "../src/common/tenant/tenant-context";

/**
 * A janela de datas dos relatórios precisa seguir o fuso da operação, não o do
 * processo. A versão anterior perdia o último dia do período e empurrava o fim
 * do mês anterior para o mês seguinte.
 */
describe("janela de datas dos relatórios", () => {
  const TZ = process.env.BUSINESS_TIMEZONE;
  beforeAll(() => { process.env.BUSINESS_TIMEZONE = "America/Sao_Paulo"; });
  afterAll(() => { process.env.BUSINESS_TIMEZONE = TZ; });

  function serviceCapturing() {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } };
    return { prisma, service: new ReportsService(prisma as never) };
  }

  function rangeOf(prisma: any) {
    return prisma.order.findMany.mock.calls[0][0].where.createdAt;
  }

  it("inclui o dia final inteiro do período", async () => {
    const { prisma, service } = serviceCapturing();

    await service.salesByPeriod("2026-01-01", "2026-01-31");

    const { gte, lt } = rangeOf(prisma);
    // 01/01 00:00 em São Paulo (UTC-3) = 01/01 03:00 UTC
    expect(gte.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    // fim exclusivo = 01/02 00:00 local, então 31/01 23:59 local está dentro
    expect(lt.toISOString()).toBe("2026-02-01T03:00:00.000Z");

    const ultimoPedidoDoMes = new Date("2026-02-01T02:59:00.000Z"); // 31/01 23:59 local
    expect(ultimoPedidoDoMes >= gte && ultimoPedidoDoMes < lt).toBe(true);
  });

  it("não puxa pedidos do fim do mês anterior para dentro do período", async () => {
    const { prisma, service } = serviceCapturing();

    await service.salesByPeriod("2026-01-01", "2026-01-31");

    const { gte } = rangeOf(prisma);
    const pedidoDe31DeDezembro = new Date("2026-01-01T01:00:00.000Z"); // 31/12 22:00 local
    expect(pedidoDe31DeDezembro < gte).toBe(true);
  });

  it("não invade o primeiro dia do mês seguinte", async () => {
    const { prisma, service } = serviceCapturing();

    await service.salesByPeriod("2026-01-01", "2026-01-31");

    const { lt } = rangeOf(prisma);
    const pedidoDePrimeiroDeFevereiro = new Date("2026-02-01T03:30:00.000Z"); // 01/02 00:30 local
    expect(pedidoDePrimeiroDeFevereiro >= lt).toBe(true);
  });

  it("recusa data em formato inválido em vez de silenciar", async () => {
    const { service } = serviceCapturing();

    await expect(service.salesByPeriod("31/01/2026", "2026-01-31")).rejects.toThrow(/data válida/i);
  });

  it("agrupa o pico por hora no fuso da loja, não no do processo", async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          // 22h em São Paulo — em UTC seria 01h do dia seguinte
          { createdAt: new Date("2026-01-16T01:00:00.000Z") },
        ]),
      },
    };
    const service = new ReportsService(prisma as never);

    const buckets = await service.peakHours("2026-01-15", "2026-01-16");

    expect(buckets[22].count).toBe(1);
    expect(buckets[1].count).toBe(0);
  });

  it("agrupa o dia no fuso da loja em growthByPeriod", async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          // 15/01 22:00 local = 16/01 01:00 UTC; deve contar em 15/01
          { createdAt: new Date("2026-01-16T01:00:00.000Z"), total: 50 },
        ]),
      },
    };
    const service = new ReportsService(prisma as never);

    const dias = await tenantContext.run({ companyId: null, bypass: true }, () =>
      service.growthByPeriod("2026-01-15", "2026-01-16"),
    );

    expect(dias[0].date).toBe("2026-01-15");
  });
});
