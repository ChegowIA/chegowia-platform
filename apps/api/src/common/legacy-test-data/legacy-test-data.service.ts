import { Inject, Injectable } from "@nestjs/common";
import { JwtPayload } from "../interfaces/jwt-payload.interface";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { PostalCodeLocationService } from "../geography/postal-code-location.service";
import { filtroPublicoDeEmpresa } from "../public-visibility/subscription-grace";

const DEMO_COMPANY_SLUG = "operacao-demo-chegowia";
// Quem enxerga a loja demo na vitrine: a conta do dono da plataforma e o
// cliente demo criado por `setup-demo-company.js`, usado nas gravações.
const DEMO_CATALOG_EMAILS = new Set(["thiagolpssouza@gmail.com", "cliente@demo.chegowia.invalid"]);
const HIDDEN_TEST_COMPANIES = { isTestOnly: false };

/**
 * Regra de transição após encerrar a homologação fechada.
 *
 * Empresas históricas marcadas como `isTestOnly` nunca são promovidas pela
 * simples remoção do modo temporário. A única exceção é uma loja demo
 * explicitamente limitada a uma conta e ao endereço salvo dela — não é uma
 * flag vinda do navegador e não pode ser usada por URL direta.
 */
@Injectable()
export class LegacyTestDataService {
  private readonly pendingDemoAccessChecks = new Map<string, Promise<string[]>>();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly postalCodeLocations: PostalCodeLocationService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async publicCompanyVisibilityWhere(viewer?: JwtPayload | null) {
    if (!viewer?.sub || !isDemoCatalogEmail(viewer.email)) return HIDDEN_TEST_COMPANIES;
    return this.visibilityForEligibleUser(viewer.sub);
  }

  /**
   * Escopo completo para resultados de catálogo que também filtram por cidade.
   *
   * A regra comercial normal continua exigindo sede/área de entrega na cidade
   * escolhida. A demo privada é diferente: para a única conta autorizada, CEP
   * e rota já foram validados antes deste método devolver a exceção. Deixá-la
   * passar pelo filtro textual de cidade a esconderia mesmo estando a poucos
   * metros, em municípios vizinhos da região metropolitana.
   */
  async publicCatalogCompanyScope(viewer?: JwtPayload | null, city?: string | null) {
    const publicCompanies = {
      isTestOnly: false,
      ...filtroPublicoDeEmpresa({ cidade: city }),
    };
    if (!viewer?.sub || !isDemoCatalogEmail(viewer.email)) return publicCompanies;
    const demoIds = await this.eligibleDemoCompanyIds(viewer.sub);
    if (!demoIds.length) return publicCompanies;

    return {
      OR: [
        publicCompanies,
        {
          id: { in: demoIds },
          isTestOnly: true,
          // A exceção continua sujeita à assinatura. Só a pré-triagem por
          // município é dispensada, pois a rota real já confirmou a distância.
          ...filtroPublicoDeEmpresa(),
        },
      ],
    };
  }

  async publicCompanyVisibilityWhereForUserId(userId?: string | null) {
    if (!userId) return HIDDEN_TEST_COMPANIES;
    const user = await this.db().user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!isDemoCatalogEmail(user?.email)) return HIDDEN_TEST_COMPANIES;
    return this.visibilityForEligibleUser(userId);
  }

  private async visibilityForEligibleUser(userId: string) {
    const demoIds = await this.eligibleDemoCompanyIds(userId);
    return demoIds.length
      ? {
        OR: [
          HIDDEN_TEST_COMPANIES,
          { id: { in: demoIds }, isTestOnly: true },
        ],
      }
      : HIDDEN_TEST_COMPANIES;
  }

  /**
   * A demo permanece opaca para todo o resto do sistema. Para a conta
   * autorizada, conferimos o CEP como triagem de vitrine. A rota completa é
   * calculada no orçamento/checkout, onde ela realmente decide se o pedido
   * pode ser entregue. Fazer uma chamada de rota em toda carga da home torna
   * a visibilidade dependente de um serviço externo e esconde uma loja válida
   * quando o provedor de mapas oscila.
   */
  private async eligibleDemoCompanyIds(userId: string): Promise<string[]> {
    const pending = this.pendingDemoAccessChecks.get(userId);
    if (pending) return pending;

    const check = this.checkPrivateDemoAccess(userId)
      .catch(() => [] as string[])
      .finally(() => this.pendingDemoAccessChecks.delete(userId));
    this.pendingDemoAccessChecks.set(userId, check);
    return check;
  }

  private async checkPrivateDemoAccess(userId: string): Promise<string[]> {
    const [user, address, root] = await Promise.all([
      this.db().user.findUnique({ where: { id: userId }, select: { email: true } }),
      this.db().address.findFirst({
        where: { userId, zipCode: { not: null } },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      }),
      this.db().company.findFirst({
        where: { slug: DEMO_COMPANY_SLUG, isActive: true, isTestOnly: true },
      }),
    ]);
    if (!isDemoCatalogEmail(user?.email) || !address?.zipCode || !root) return [];
    const descendants = await this.db().company.findMany({
      where: { demoRootCompanyId: root.id, isActive: true, isTestOnly: true },
    });
    const matches = await Promise.all([root, ...descendants].map(async (company: any) => {
      if (!company.zipCode) return null;
      const radiusKm = Number(company.deliveryRadiusKm);
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) return null;
      const nearby = await this.postalCodeLocations.isLikelyWithinDeliveryRadius({
        customerZipCode: address.zipCode,
        customerHint: { city: address.city, state: address.state },
        companyZipCode: company.zipCode,
        companyHint: { city: company.city, state: company.state },
        deliveryRadiusKm: radiusKm,
      });
      return nearby ? company.id as string : null;
    }));
    return matches.filter((id): id is string => Boolean(id));
  }
}

function isDemoCatalogEmail(value?: string | null) {
  return DEMO_CATALOG_EMAILS.has(value?.trim().toLowerCase() ?? "");
}
