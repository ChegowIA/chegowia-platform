import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PromotionStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { assinaturaPermiteAparecerNoCatalogo } from "../common/public-visibility/subscription-grace";
import { LegacyTestDataService } from "../common/legacy-test-data/legacy-test-data.service";

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly legacyTestData?: LegacyTestDataService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  list() {
    return this.db().promotion.findMany({ orderBy: { createdAt: "desc" } });
  }

  async create(data: { title: string; description?: string; discountType: string; discountValue: number; startsAt?: Date | string; endsAt?: Date | string }) {
    return this.db().promotion.create({ data: { ...data, status: PromotionStatus.ATIVA } });
  }

  async publicList(params: { city?: string }, viewer?: JwtPayload) {
    const now = new Date();
    const city = params.city?.trim();
    const companyWhere: any = {
      isActive: true,
      ...(this.legacyTestData?.publicCompanyVisibilityWhere(viewer) ?? { isTestOnly: false }),
      ...assinaturaPermiteAparecerNoCatalogo(),
    };
    // Igualdade, não `contains`: "Rio Branco" casaria com "Rio Branco do Sul"
    // e mostraria ao cliente uma loja de outro estado. A comparação já ignora
    // acento e caixa pela collation `utf8mb4_unicode_ci` da coluna.
    if (city) companyWhere.city = city;
    return this.db().promotion.findMany({
      where: {
        status: PromotionStatus.ATIVA,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
        company: { is: companyWhere },
      },
      take: 10,
      orderBy: { updatedAt: "desc" },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            state: true,
            logoUrl: true,
            avgDeliveryTimeMinutes: true,
            deliveryFeeBase: true,
          },
        },
      },
    });
  }

  async setStatus(id: string, status: PromotionStatus) {
    const promotion = await this.db().promotion.findUnique({ where: { id } });
    if (!promotion) throw new NotFoundException("Promoção não encontrada.");
    return this.db().promotion.update({ where: { id }, data: { status } });
  }
}
