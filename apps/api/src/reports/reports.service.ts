import { Inject, Injectable } from "@nestjs/common";
import { OrderStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";

function parseRange(from?: string, to?: string) {
  const start = from ? new Date(from) : new Date(new Date().setDate(new Date().getDate() - 30));
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  // ---------------------------------------------------------------------
  // Relatórios da empresa (tenant-scoped automaticamente pelo Prisma extension)
  // ---------------------------------------------------------------------

  async salesByPeriod(from?: string, to?: string) {
    const { start, end } = parseRange(from, to);
    const orders = await this.db().order.findMany({
      where: { createdAt: { gte: start, lte: end }, status: { not: OrderStatus.CANCELADO } },
      select: { id: true, total: true, createdAt: true, status: true },
    });

    const revenue = orders.reduce((sum: number, o: any) => sum + Number(o.total), 0);
    return {
      period: { from: start, to: end },
      ordersCount: orders.length,
      revenue,
      averageTicket: orders.length ? revenue / orders.length : 0,
    };
  }

  async ordersByStatus() {
    const grouped = await this.db().order.groupBy({ by: ["status"], _count: { _all: true } });
    return grouped.map((g: any) => ({ status: g.status, count: g._count._all }));
  }

  async topProducts(from?: string, to?: string, limit = 10) {
    const { start, end } = parseRange(from, to);
    const grouped = await this.db().orderItem.groupBy({
      by: ["productId", "productName"],
      where: { order: { createdAt: { gte: start, lte: end }, status: { not: OrderStatus.CANCELADO } } },
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
    return grouped.map((g: any) => ({
      productId: g.productId,
      productName: g.productName,
      quantitySold: g._sum.quantity ?? 0,
      revenue: Number(g._sum.totalPrice ?? 0),
    }));
  }

  async recurringCustomers(minOrders = 2) {
    return this.db().customerProfile.findMany({
      where: { totalOrders: { gte: minOrders } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { totalOrders: "desc" },
    });
  }

  async delayedDeliveries(thresholdMinutes = 45) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    return this.db().delivery.findMany({
      where: { status: { not: "ENTREGUE" }, createdAt: { lt: threshold } },
      include: { motoboy: { select: { name: true } }, order: { select: { id: true, deliveryNeighborhood: true } } },
    });
  }

  async motoboyPerformance() {
    const deliveries = await this.db().delivery.findMany({
      where: { motoboyId: { not: null }, status: "ENTREGUE" },
      select: { motoboyId: true, motoboy: { select: { name: true } }, pickedUpAt: true, deliveredAt: true },
    });

    const byMotoboy = new Map<string, { name: string; count: number; totalMinutes: number }>();
    for (const d of deliveries) {
      const entry = byMotoboy.get(d.motoboyId) ?? { name: d.motoboy?.name ?? "—", count: 0, totalMinutes: 0 };
      entry.count += 1;
      if (d.pickedUpAt && d.deliveredAt) {
        entry.totalMinutes += (new Date(d.deliveredAt).getTime() - new Date(d.pickedUpAt).getTime()) / 60000;
      }
      byMotoboy.set(d.motoboyId, entry);
    }

    return Array.from(byMotoboy.entries()).map(([motoboyId, v]) => ({
      motoboyId,
      name: v.name,
      deliveriesCompleted: v.count,
      averageMinutesPerDelivery: v.count ? Math.round(v.totalMinutes / v.count) : 0,
    }));
  }

  async peakHours(from?: string, to?: string) {
    const { start, end } = parseRange(from, to);
    const orders = await this.db().order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { createdAt: true },
    });
    const buckets = new Array(24).fill(0);
    for (const o of orders) buckets[new Date(o.createdAt).getHours()] += 1;
    return buckets.map((count, hour) => ({ hour, count }));
  }

  // ---------------------------------------------------------------------
  // Relatórios globais da plataforma (SUPER_ADMIN — cruza todas as empresas)
  // ---------------------------------------------------------------------

  async globalOverview() {
    const [activeCompanies, totalCompanies, totalOrders, revenueAgg] = await Promise.all([
      this.db().company.count({ where: { isActive: true } }),
      this.db().company.count(),
      this.db().order.count(),
      this.db().order.aggregate({ _sum: { total: true }, where: { status: { not: OrderStatus.CANCELADO } } }),
    ]);
    return {
      activeCompanies,
      totalCompanies,
      totalOrders,
      estimatedRevenue: Number(revenueAgg._sum.total ?? 0),
    };
  }

  async topCompaniesByOrders(limit = 10) {
    const grouped = await this.db().order.groupBy({
      by: ["companyId"],
      _count: { _all: true },
      _sum: { total: true },
      orderBy: { _count: { companyId: "desc" } },
      take: limit,
    });
    const companies = await this.db().company.findMany({
      where: { id: { in: grouped.map((g: any) => g.companyId) } },
      select: { id: true, name: true, slug: true },
    });
    const companyMap = new Map(companies.map((c: any) => [c.id, c]));
    return grouped.map((g: any) => ({
      company: companyMap.get(g.companyId),
      ordersCount: g._count._all,
      revenue: Number(g._sum.total ?? 0),
    }));
  }

  async growthByPeriod(from?: string, to?: string) {
    const { start, end } = parseRange(from, to);
    const orders = await this.db().order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { createdAt: true, total: true },
    });
    const byDay = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10);
      const entry = byDay.get(key) ?? { orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += Number(o.total);
      byDay.set(key, entry);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  }
}
