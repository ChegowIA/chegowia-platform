import { Inject, Injectable, Logger } from "@nestjs/common";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { GeographicPoint, GeographyService, PostalCodeHint } from "./geography.service";

const CEP_PATTERN = /^\d{8}$/;

export interface PostalDistanceCompany {
  id: string;
  zipCode?: string | null;
  city?: string | null;
  state?: string | null;
  deliveryRadiusKm: number | string | { toString(): string };
}

/** Remove máscara e devolve apenas CEPs brasileiros completos. */
export function normalizePostalCode(value: unknown): string | null {
  const normalized = String(value ?? "").replace(/\D/g, "");
  return CEP_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Cache persistente dos centros aproximados dos CEPs.
 *
 * A busca pública não pode pedir uma rota OSRM para cada loja a cada visita.
 * Por isso ela compara centros de CEP (rápido e sem dados de rua); no checkout
 * a rota com endereço completo ainda é obrigatória e é a fonte de verdade.
 */
@Injectable()
export class PostalCodeLocationService {
  private readonly logger = new Logger(PostalCodeLocationService.name);
  private readonly pendingResolutions = new Map<string, Promise<GeographicPoint>>();

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly geography: GeographyService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  /** Resolve e grava um centro de CEP, compartilhado entre todas as contas. */
  async resolve(zipCode: unknown, hint: PostalCodeHint = {}): Promise<GeographicPoint> {
    const normalizedZipCode = normalizePostalCode(zipCode);
    if (!normalizedZipCode) throw new Error("CEP inválido para localização.");

    const current = await this.findCached(normalizedZipCode);
    if (current) return current;

    const pending = this.pendingResolutions.get(normalizedZipCode);
    if (pending) return pending;

    const resolution = this.geography.geocodePostalCode(normalizedZipCode, hint)
      .then(async (coordinates) => {
        await this.db().postalCodeLocation.upsert({
          where: { zipCode: normalizedZipCode },
          create: { zipCode: normalizedZipCode, ...coordinates },
          update: coordinates,
        });
        return coordinates;
      })
      .finally(() => this.pendingResolutions.delete(normalizedZipCode));
    this.pendingResolutions.set(normalizedZipCode, resolution);
    return resolution;
  }

  /**
   * Aquecimento não bloqueante após salvar um endereço. Se o geocodificador
   * estiver indisponível, o fluxo de cadastro continua e a próxima consulta
   * tenta de novo; a rota completa no checkout segue protegendo a entrega.
   */
  warm(zipCode: unknown, hint: PostalCodeHint = {}) {
    const normalizedZipCode = normalizePostalCode(zipCode);
    if (!normalizedZipCode) return;
    void this.resolve(normalizedZipCode, hint).catch((error) => {
      this.logger.warn(`Não foi possível aquecer o CEP ${normalizedZipCode}: ${errorMessage(error)}`);
    });
  }

  /**
   * Compara centro de CEPs antes de a loja entrar no catálogo. A folga cobre
   * o fato de CEP representar uma área e de a rota por ruas ser maior que a
   * linha reta. A confirmação final continua sendo a rota real.
   */
  async isLikelyWithinDeliveryRadius(input: {
    customerZipCode: unknown;
    customerHint?: PostalCodeHint;
    companyZipCode: unknown;
    companyHint?: PostalCodeHint;
    deliveryRadiusKm: unknown;
  }): Promise<boolean> {
    const radiusKm = Number(input.deliveryRadiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
    const customerZipCode = normalizePostalCode(input.customerZipCode);
    const companyZipCode = normalizePostalCode(input.companyZipCode);
    if (!customerZipCode || !companyZipCode) return false;

    const [customer, company] = await Promise.all([
      this.resolve(customerZipCode, input.customerHint),
      this.resolve(companyZipCode, input.companyHint),
    ]);
    return this.distanceKm(customer, company) <= this.catalogRadiusWithPostalMargin(radiusKm);
  }

  /**
   * Filtra candidatas já reduzidas por cidade/área atendida. O CEP do cliente
   * é aquecido quando o endereço é salvo; CEPs de lojas ainda sem cache não
   * derrubam toda a vitrine e são aquecidos para a próxima consulta. Isso evita
   * catálogo vazio se o serviço de mapas estiver temporariamente indisponível.
   */
  async filterCompaniesForCustomerPostalCode(
    customerZipCode: unknown,
    _customerHint: PostalCodeHint,
    companies: PostalDistanceCompany[],
  ): Promise<string[]> {
    const normalizedCustomerZipCode = normalizePostalCode(customerZipCode);
    if (!normalizedCustomerZipCode) return [];

    const customer = await this.findCached(normalizedCustomerZipCode);
    if (!customer) {
      // A criação/edição do endereço já aquece este CEP. A vitrine não faz uma
      // chamada externa a partir de um parâmetro público, para não transformar
      // CEPs arbitrários em fila de geocodificação. Até o cache ficar pronto,
      // vale a triagem por cidade/área do chamador e a rota do checkout.
      return companies.filter((company) => Boolean(normalizePostalCode(company.zipCode))).map((company) => company.id);
    }

    const zipCodes = Array.from(new Set(
      companies.map((company) => normalizePostalCode(company.zipCode)).filter((zipCode): zipCode is string => Boolean(zipCode)),
    ));
    const cached = zipCodes.length
      ? await this.db().postalCodeLocation.findMany({
        where: { zipCode: { in: zipCodes } },
        select: { zipCode: true, latitude: true, longitude: true },
      })
      : [];
    const locations = new Map<string, GeographicPoint>();
    for (const location of cached) {
      const point = toPoint(location);
      if (point) locations.set(location.zipCode, point);
    }

    return companies.flatMap((company) => {
      const zipCode = normalizePostalCode(company.zipCode);
      if (!zipCode) return [];
      const location = locations.get(zipCode);
      if (!location) {
        this.warm(zipCode, { city: company.city, state: company.state });
        // A regra de cidade/área já foi aplicada pelo chamador. Enquanto a
        // referência do CEP nasce, mantemos essa compatibilidade segura.
        return [company.id];
      }
      const radiusKm = Number(company.deliveryRadiusKm);
      return Number.isFinite(radiusKm) && radiusKm > 0
        && this.distanceKm(customer, location) <= this.catalogRadiusWithPostalMargin(radiusKm)
        ? [company.id]
        : [];
    });
  }

  distanceKm(first: GeographicPoint, second: GeographicPoint) {
    const earthRadiusKm = 6_371;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude))
      * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private catalogRadiusWithPostalMargin(radiusKm: number) {
    // CEP pode cobrir um bairro inteiro. Sem uma margem, uma loja no limite
    // seria ocultada apesar de a rota real poder caber no raio configurado.
    return radiusKm * 1.45 + 2;
  }

  private async findCached(zipCode: string): Promise<GeographicPoint | null> {
    const cached = await this.db().postalCodeLocation.findUnique({
      where: { zipCode },
      select: { latitude: true, longitude: true },
    });
    return toPoint(cached);
  }
}

function toPoint(value: any): GeographicPoint | null {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "erro desconhecido";
}
