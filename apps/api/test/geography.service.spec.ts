import { GeographyService } from "../src/common/geography/geography.service";

describe("GeographyService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
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
});
