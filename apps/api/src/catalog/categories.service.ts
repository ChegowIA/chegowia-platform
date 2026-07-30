import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";

@Injectable()
export class CategoriesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  // As chamadas abaixo NÃO passam companyId explicitamente: o Prisma extension de
  // tenant (common/prisma/prisma-client.factory.ts) injeta automaticamente a partir
  // do contexto do usuário logado (ver TenantInterceptor).
  list() {
    return this.db().category.findMany({
      orderBy: { position: "asc" },
      include: { _count: { select: { products: true } } },
    });
  }

  async create(dto: CreateCategoryDto) {
    return this.db().category.create({ data: dto });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.ensureExists(id);
    return this.db().category.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.db().category.update({ where: { id }, data: { isActive: false } });
  }

  private async ensureExists(id: string) {
    const category = await this.db().category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException("Categoria não encontrada.");
    return category;
  }
}
