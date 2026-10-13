import { GeographyService } from "../src/common/geography/geography.service";

describe("GeographyService", () => {
  const originalFetch = global.fetch;
  const originalGeocodingInterval = process.env.GEOCODING_MIN_INTERVAL_MS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalGeocodingInterval === undefined) delete process.env.GEOCODING_MIN_INTERVAL_MS;
    else process.env.GEOCODING_MIN_INTERVAL_MS = originalGeocodingInterval;
    jest.restoreAllMocks();
  });

  it("traduz o CEP pelo ViaCEP antes de pedir a coordenada ao geocodificador", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cep: "74013-010",
          logradouro: "Rua 1",
          bairro: "Setor Central",
          localidade: "Goiânia",
          uf: "GO",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: "-16.6784398", lon: "-49.2563466" }],
      });
    global.fetch = fetchMock as never;

    const service = new GeographyService();
    await expect(service.geocodePostalCode("74013-010", { city: "Outra cidade", state: "SP" }))
      .resolves.toEqual({ latitude: -16.6784398, longitude: -49.2563466 });

    expect(new URL(fetchMock.mock.calls[0][0].toString()).pathname).toBe("/ws/74013010/json/");
    const geocodingUrl = new URL(fetchMock.mock.calls[1][0].toString());
    expect(geocodingUrl.searchParams.get("q")).toContain("Rua 1, Setor Central, Goiânia, GO, 74013010");
  });

  it("recusa CEP que o ViaCEP não reconhece", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: true }) });
    global.fetch = fetchMock as never;

    const service = new GeographyService();
    await expect(service.geocodePostalCode("74000-000"))
      .rejects.toThrow("Não foi possível localizar esse CEP.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("localiza a rua quando o número e o CEP não são encontrados juntos", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: "-16.8201544", lon: "-49.2645848" }],
      });
    global.fetch = fetchMock as never;
    process.env.GEOCODING_MIN_INTERVAL_MS = "0";

    const service = new GeographyService();
    await expect(service.geocode({
      addressLine: "Rua Guarapari, 0",
      streetName: "Rua Guarapari",
      neighborhood: "Jardim Ipiranga",
      city: "Aparecida de Goiânia",
      state: "GO",
      zipCode: "74968190",
    })).resolves.toEqual({ latitude: -16.8201544, longitude: -49.2645848 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(fetchMock.mock.calls[0][0].toString()).searchParams.get("q"))
      .toContain("Rua Guarapari, 0, Jardim Ipiranga");
    expect(new URL(fetchMock.mock.calls[2][0].toString()).searchParams.get("q"))
      .toBe("Rua Guarapari, Jardim Ipiranga, Aparecida de Goiânia, GO, Brasil");
  });

  it("mantém o erro quando nem mesmo a rua pode ser localizada", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
    process.env.GEOCODING_MIN_INTERVAL_MS = "0";

    await expect(new GeographyService().geocode({
      addressLine: "Rua Inexistente, 12",
      streetName: "Rua Inexistente",
      city: "Goiânia",
      state: "GO",
      zipCode: "74000000",
    })).rejects.toThrow("Não foi possível localizar esse endereço.");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
