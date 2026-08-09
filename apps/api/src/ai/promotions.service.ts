import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PromotionStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { TemporaryTestModeService } from "../common/test-mode/test-mode.service";

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly temporaryTestMode?: TemporaryTestModeService,
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
      ...((await this.temporaryTestMode?.publicCompanyVisibilityWhere(viewer)) ?? {}),
    };
    if (city) companyWhere.city = { contains: city };
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
