import { Inject, Injectable } from "@nestjs/common";
import { JwtPayload } from "../interfaces/jwt-payload.interface";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { GeographicPoint, GeographyService } from "../geography/geography.service";
import { PostalCodeLocationService } from "../geography/postal-code-location.service";
import { filtroPublicoDeEmpresa } from "../public-visibility/subscription-grace";

const DEMO_COMPANY_SLUG = "operacao-demo-chegowia";
const DEMO_CATALOG_EMAIL = "thiagolpssouza@gmail.com";
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
  private readonly pendingDemoAccessChecks = new Map<string, Promise<boolean>>();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly geography: GeographyService,
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
    if (!(await this.canViewPrivateDemo(viewer.sub))) return publicCompanies;

    return {
      OR: [
        publicCompanies,
        {
          slug: DEMO_COMPANY_SLUG,
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
    return await this.canViewPrivateDemo(userId)
      ? {
        OR: [
          HIDDEN_TEST_COMPANIES,
          { slug: DEMO_COMPANY_SLUG, isTestOnly: true },
        ],
      }
      : HIDDEN_TEST_COMPANIES;
  }

  /**
   * A demo permanece opaca para todo o resto do sistema. Para a conta
   * autorizada, conferimos CEP (triagem média) e depois a mesma rota por ruas
   * que decide o checkout; qualquer falha mantém a loja escondida.
   */
  private async canViewPrivateDemo(userId: string): Promise<boolean> {
    const pending = this.pendingDemoAccessChecks.get(userId);
    if (pending) return pending;

    const check = this.checkPrivateDemoAccess(userId)
      .catch(() => false)
      .finally(() => this.pendingDemoAccessChecks.delete(userId));
    this.pendingDemoAccessChecks.set(userId, check);
    return check;
  }

  private async checkPrivateDemoAccess(userId: string): Promise<boolean> {
    const [address, company] = await Promise.all([
      this.db().address.findFirst({
        where: { userId, zipCode: { not: null } },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      }),
      this.db().company.findFirst({
        where: { slug: DEMO_COMPANY_SLUG, isActive: true, isTestOnly: true },
      }),
    ]);
    if (!address || !company || !address.zipCode || !company.zipCode) {
      return false;
    }

    const radiusKm = Number(company.deliveryRadiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;

    const likelyWithinRange = await this.postalCodeLocations.isLikelyWithinDeliveryRadius({
      customerZipCode: address.zipCode,
      customerHint: { city: address.city, state: address.state },
      companyZipCode: company.zipCode,
      companyHint: { city: company.city, state: company.state },
      deliveryRadiusKm: radiusKm,
    });
    if (!likelyWithinRange) return false;

    const [origin, destination] = await Promise.all([
      this.resolveCompanyCoordinates(company),
      this.resolveAddressCoordinates(address),
    ]);
    const route = await this.geography.calculateDrivingRoute(origin, destination);
    return route.distanceKm <= radiusKm;
  }

  private async resolveCompanyCoordinates(company: any): Promise<GeographicPoint> {
    const existing = readCoordinates(company);
    if (existing) return existing;
    if (!company.addressLine?.trim() || !company.city?.trim() || !company.state?.trim() || !company.zipCode?.trim()) {
      throw new Error("Empresa demo sem endereço operacional completo.");
    }
    const coordinates = await this.geography.geocode({
      addressLine: company.addressLine,
      city: company.city,
      state: company.state,
      zipCode: company.zipCode,
    });
    await this.db().company.update({ where: { id: company.id }, data: coordinates });
    return coordinates;
  }

  private async resolveAddressCoordinates(address: any): Promise<GeographicPoint> {
    const existing = readCoordinates(address);
    if (existing) return existing;
    const addressLine = [address.street, address.number, address.complement]
      .filter((part) => typeof part === "string" && part.trim())
      .join(", ");
    const coordinates = await this.geography.geocode({
      addressLine,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: address.zipCode,
    });
    await this.db().address.update({ where: { id: address.id }, data: coordinates });
    return coordinates;
  }
}

function isDemoCatalogEmail(value?: string | null) {
  return value?.trim().toLowerCase() === DEMO_CATALOG_EMAIL;
}

function readCoordinates(value: { latitude?: unknown; longitude?: unknown }): GeographicPoint | null {
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}
