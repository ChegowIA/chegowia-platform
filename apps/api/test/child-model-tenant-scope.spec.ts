import { ReportsService } from "../src/reports/reports.service";
import { ToolsService } from "../src/ai/tools/tools.service";
import { tenantContext } from "../src/common/tenant/tenant-context";

/**
 * `OrderItem` não tem `companyId` e por isso está fora do TENANT_MODELS. A
 * extensão do Prisma só reescreve o `where` de topo do model consultado, nunca
 * filtros de relação — então um `groupBy` filtrado por `order: {...}` cruza
 * todas as empresas se o `companyId` não for aplicado à mão.
 *
 * Estes testes travam esse contrato: se alguém remover o filtro, quebram.
 */
describe("escopo de empresa em models sem companyId próprio", () => {
  function prismaSpy() {
    return {
      orderItem: { groupBy: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  describe("relatório de produtos mais vendidos", () => {
    it("filtra pela empresa do contexto", async () => {
      const prisma = prismaSpy();
      const service = new ReportsService(prisma as never);

      await tenantContext.run({ companyId: "empresa-A", bypass: false }, () =>
        service.topProducts("2026-01-01", "2026-01-31"),
      );

      const where = prisma.orderItem.groupBy.mock.calls[0][0].where;
      expect(where.order.companyId).toBe("empresa-A");
    });

    it("não vaza produtos de outra empresa quando o contexto é de uma só", async () => {
      const prisma = prismaSpy();
      const service = new ReportsService(prisma as never);

      await tenantContext.run({ companyId: "empresa-B", bypass: false }, () => service.topProducts());

      const where = prisma.orderItem.groupBy.mock.calls[0][0].where;
      expect(where.order.companyId).not.toBe("empresa-A");
      expect(where.order).toHaveProperty("companyId");
    });

    it("mantém a visão global do SUPER_ADMIN em bypass", async () => {
      const prisma = prismaSpy();
      const service = new ReportsService(prisma as never);

      await tenantContext.run({ companyId: null, bypass: true }, () => service.topProducts());

      const where = prisma.orderItem.groupBy.mock.calls[0][0].where;
      expect(where.order.companyId).toBeUndefined();
    });

    it("recusa quando não há empresa e não é bypass, em vez de devolver tudo", async () => {
      const prisma = prismaSpy();
      const service = new ReportsService(prisma as never);

      await expect(
        tenantContext.run({ companyId: null, bypass: false }, () => service.topProducts()),
      ).rejects.toThrow(/empresa/i);
      expect(prisma.orderItem.groupBy).not.toHaveBeenCalled();
    });
  });

  describe("ferramenta getTopProducts do agente de IA", () => {
    it("usa o companyId recebido, já que o scoped() não alcança OrderItem", async () => {
      const prisma = prismaSpy();
      const tools = new ToolsService(prisma as never, {} as never, {} as never);

      await tools.getTopProducts("empresa-A", "month");

      const where = prisma.orderItem.groupBy.mock.calls[0][0].where;
      expect(where.order.companyId).toBe("empresa-A");
    });
  });
});
