import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export interface GeographicAddress {
  addressLine: string;
  streetName?: string | null;
  neighborhood?: string | null;
  city: string;
  state: string;
  zipCode?: string | null;
}

export interface DrivingRoute {
  distanceKm: number;
  durationMinutes: number;
}

export interface PostalCodeHint {
  city?: string | null;
  state?: string | null;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
}

interface ViaCepResult {
  erro?: boolean | string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

interface BrasilApiCepV2Result {
  cep?: string;
  city?: string;
  state?: string;
  location?: {
    coordinates?: { latitude?: string | number; longitude?: string | number };
  };
}

interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
}

/**
 * Resolve endereços e rotas no servidor. Os endpoints são configuráveis para que
 * produção possa apontar para um provedor contratado ou uma instância própria.
 */
@Injectable()
export class GeographyService {
  private geocodingChain: Promise<unknown> = Promise.resolve();
  private lastGeocodingRequestAt = 0;

  async geocode(address: GeographicAddress): Promise<GeographicPoint> {
    const queries = [this.formatAddress(address)];
    if (address.streetName?.trim()) {
      const streetAddress = { ...address, addressLine: address.streetName.trim() };
      queries.push(this.formatAddress(streetAddress));
      queries.push(this.formatAddress({ ...streetAddress, zipCode: null }));
    }
    for (const query of new Set(queries)) {
      const point = await this.enqueueGeocoding(async () => {
        const endpoint = process.env.GEOCODING_BASE_URL ?? "https://nominatim.openstreetmap.org/search";
        const url = new URL(endpoint);
        url.searchParams.set("q", query);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "1");
        url.searchParams.set("countrycodes", "br");
        url.searchParams.set("accept-language", "pt-BR");

        const results = await this.requestJson<NominatimResult[]>(url, {
          Accept: "application/json",
          "User-Agent": process.env.GEOCODING_USER_AGENT ?? "ChegowIA/1.0 (local development)",
        });
        const result = results[0];
        const latitude = Number(result?.lat);
        const longitude = Number(result?.lon);
        return typeof result?.lat === "string" && typeof result?.lon === "string"
          && Number.isFinite(latitude) && Number.isFinite(longitude)
          && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
          ? { latitude, longitude }
          : null;
      });
      if (point) return point;
    }
    throw new BadRequestException(
      "Não foi possível localizar esse endereço. Revise rua, número, cidade e estado.",
    );
  }

  /**
   * Localiza o centro aproximado de um CEP. Esta coordenada serve para a
   * triagem leve do catálogo e, quando o endereço exato não é indexado, como
   * ponto aproximado para calcular a rota no checkout.
   */
  async geocodePostalCode(zipCode: string, hint: PostalCodeHint = {}): Promise<GeographicPoint> {
    const normalizedZipCode = String(zipCode ?? "").replace(/\D/g, "");
    if (!/^\d{8}$/.test(normalizedZipCode)) {
      throw new BadRequestException("Informe um CEP com 8 dígitos.");
    }

    // O Nominatim não indexa CEPs brasileiros de forma consistente. Primeiro
    // traduzimos o CEP para logradouro/localidade via ViaCEP e só então usamos
    // o geocodificador configurado para obter a coordenada aproximada.
    let postalAddress: ViaCepResult;
    try {
      postalAddress = await this.lookupPostalCode(normalizedZipCode);
    } catch {
      // O segundo provedor pode continuar disponível mesmo quando o ViaCEP
      // estiver fora do ar. Nunca aproximamos com cidade/estado inventados.
      return this.lookupBrasilApiCoordinates(normalizedZipCode, hint);
    }
    if (postalAddress.erro === true || postalAddress.erro === "true") {
      throw new BadRequestException("Não foi possível localizar esse CEP.");
    }
    const city = postalAddress.localidade?.trim() || hint.city?.trim();
    const state = postalAddress.uf?.trim() || hint.state?.trim();
    if (city && state) {
      try {
        return await this.geocode({
          addressLine: postalAddress.logradouro?.trim() || postalAddress.bairro?.trim() || `CEP ${normalizedZipCode}`,
          streetName: postalAddress.logradouro?.trim(),
          neighborhood: postalAddress.bairro?.trim(),
          city,
          state,
          zipCode: normalizedZipCode,
        });
      } catch {
        // Endereços brasileiros nem sempre são indexados pelo Nominatim.
        // BrasilAPI V2 fornece um ponto de CEP independente da consulta acima.
      }
    }
    return this.lookupBrasilApiCoordinates(normalizedZipCode, { city, state });
  }

  private async lookupBrasilApiCoordinates(zipCode: string, hint: PostalCodeHint): Promise<GeographicPoint> {
    const baseUrl = (process.env.BRASILAPI_CEP_BASE_URL ?? "https://brasilapi.com.br/api/cep/v2").replace(/\/+$/, "");
    const url = new URL(`${baseUrl}/${zipCode}`);
    let response: BrasilApiCepV2Result;
    try {
      response = await this.requestJson<BrasilApiCepV2Result>(url, {
        Accept: "application/json",
        "User-Agent": process.env.GEOCODING_USER_AGENT ?? "ChegowIA/1.0 (local development)",
      });
    } catch {
      throw new ServiceUnavailableException("Não foi possível obter a localização desse CEP agora. Tente novamente.");
    }
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    if ((response.cep && response.cep.replace(/\D/g, "") !== zipCode)
      || (hint.city && response.city && normalize(hint.city) !== normalize(response.city))
      || (hint.state && response.state && normalize(hint.state) !== normalize(response.state))) {
      throw new BadRequestException("O CEP não corresponde à cidade e ao estado informados.");
    }
    const rawLatitude = response.location?.coordinates?.latitude;
    const rawLongitude = response.location?.coordinates?.longitude;
    const latitude = Number(rawLatitude);
    const longitude = Number(rawLongitude);
    if (rawLatitude === undefined || rawLatitude === null || rawLatitude === ""
      || rawLongitude === undefined || rawLongitude === null || rawLongitude === ""
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new BadRequestException("Esse CEP não possui coordenadas disponíveis. Confira o CEP informado.");
    }
    return { latitude, longitude };
  }

  async calculateDrivingRoute(origin: GeographicPoint, destination: GeographicPoint): Promise<DrivingRoute> {
    const endpoint = (process.env.ROUTING_BASE_URL ?? "https://router.project-osrm.org/route/v1/driving")
      .replace(/\/+$/, "");
    const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = new URL(`${endpoint}/${coordinates}`);
    url.searchParams.set("overview", "false");

    const response = await this.requestJson<OsrmRouteResponse>(url, { Accept: "application/json" });
    const route = response.routes?.[0];
    const distanceMeters = Number(route?.distance);
    const durationSeconds = Number(route?.duration);
    if (response.code !== "Ok" || !Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      throw new ServiceUnavailableException("Não foi possível calcular a rota de entrega agora. Tente novamente.");
    }
    return {
      distanceKm: this.round(distanceMeters / 1_000, 2),
      durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
    };
  }

  private enqueueGeocoding<T>(request: () => Promise<T>): Promise<T> {
    const execute = async () => {
      const minimumInterval = this.readNumberEnv("GEOCODING_MIN_INTERVAL_MS", 1_100, 0, 60_000);
      const waitMs = Math.max(0, this.lastGeocodingRequestAt + minimumInterval - Date.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      this.lastGeocodingRequestAt = Date.now();
      return request();
    };
    const result = this.geocodingChain.then(execute, execute) as Promise<T>;
    this.geocodingChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async lookupPostalCode(zipCode: string) {
    const baseUrl = (process.env.VIACEP_BASE_URL ?? "https://viacep.com.br/ws").replace(/\/+$/, "");
    const url = new URL(`${baseUrl}/${zipCode}/json/`);
    return this.requestJson<ViaCepResult>(url, {
      Accept: "application/json",
      "User-Agent": process.env.GEOCODING_USER_AGENT ?? "ChegowIA/1.0 (local development)",
    });
  }

  private async requestJson<T>(url: URL, headers: Record<string, string>): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = this.readNumberEnv("GEOGRAPHY_REQUEST_TIMEOUT_MS", 8_000, 1_000, 30_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new ServiceUnavailableException("O serviço de mapas está temporariamente indisponível.");
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException("O serviço de mapas está temporariamente indisponível.");
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatAddress(address: GeographicAddress) {
    return [address.addressLine, address.neighborhood, address.city, address.state, address.zipCode, "Brasil"]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(", ");
  }

  private readNumberEnv(name: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  private round(value: number, decimals: number) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}
