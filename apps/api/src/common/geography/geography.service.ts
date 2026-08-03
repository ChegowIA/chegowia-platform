import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";

export interface GeographicPoint {
  latitude: number;
  longitude: number;
}

export interface GeographicAddress {
  addressLine: string;
  neighborhood?: string | null;
  city: string;
  state: string;
  zipCode?: string | null;
}

export interface DrivingRoute {
  distanceKm: number;
  durationMinutes: number;
}

interface NominatimResult {
  lat?: string;
  lon?: string;
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
    return this.enqueueGeocoding(async () => {
      const endpoint = process.env.GEOCODING_BASE_URL ?? "https://nominatim.openstreetmap.org/search";
      const url = new URL(endpoint);
      url.searchParams.set("q", this.formatAddress(address));
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
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new BadRequestException(
          "Não foi possível localizar esse endereço. Revise rua, número, cidade e estado.",
        );
      }
      return { latitude, longitude };
    });
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
