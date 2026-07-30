import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";

@Injectable()
export class CustomersService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  // CustomerProfile é tenant-scoped — resultado já vem filtrado para a empresa logada.
  async list(query: PaginationQueryDto) {
    const where: any = query.search
      ? { user: { OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }] } }
      : {};

    const [items, total] = await Promise.all([
      this.db().customerProfile.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { lastOrderAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.db().customerProfile.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  /** Clientes que não compram há N dias — base do tool de IA getInactiveCustomers. */
  async listInactive(days: number) {
    const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.db().customerProfile.findMany({
      where: {
        OR: [{ lastOrderAt: { lt: threshold } }, { lastOrderAt: null, createdAt: { lt: threshold } }],
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { lastOrderAt: "asc" },
    });
  }
}
