import { GupshupWhatsAppProvider } from "../src/messaging/providers/gupshup-whatsapp.provider";

/**
 * O Gupshup usa nomes próprios em três campos do perfil, e enviar o nome errado
 * não dá erro: o campo é simplesmente ignorado. Foi o que fez e-mail, descrição
 * e endereço não mudarem no WhatsApp mesmo com o painel dizendo que salvou.
 *
 * Estes testes fixam a tradução dos nomes e a validação da resposta — o Gupshup
 * responde HTTP 200 mesmo quando recusa.
 */
describe("perfil do WhatsApp no Gupshup", () => {
  const ORIGINAL_ENV = { ...process.env };
  let provider: GupshupWhatsAppProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    process.env.GUPSHUP_API_KEY = "chave-de-teste";
    provider = new GupshupWhatsAppProvider();
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function respondWith(body: unknown, ok = true) {
    fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body) });
  }

  function sentForm() {
    return new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  }

  it("traduz e-mail e descrição para os nomes que o Gupshup espera", async () => {
    respondWith({ status: "success" });

    await provider.updateBusinessProfile({
      appId: "app-1",
      appToken: "",
      profile: { email: "contato@empresa.com.br", description: "Pizzaria artesanal" },
    });

    const form = sentForm();
    expect(form.get("profileEmail")).toBe("contato@empresa.com.br");
    expect(form.get("desc")).toBe("Pizzaria artesanal");
    // Os nomes nossos não podem vazar: eles seriam ignorados em silêncio.
    expect(form.get("email")).toBeNull();
    expect(form.get("description")).toBeNull();
  });

  it("envia o endereço em campos separados, e não como texto único", async () => {
    respondWith({ status: "success" });

    await provider.updateBusinessProfile({
      appId: "app-1",
      appToken: "",
      profile: {
        addressLine1: "Rua das Flores, 100",
        city: "Goiânia",
        state: "GO",
        pinCode: "74000-000",
        country: "Brasil",
      },
    });

    const form = sentForm();
    expect(form.get("addLine1")).toBe("Rua das Flores, 100");
    expect(form.get("city")).toBe("Goiânia");
    expect(form.get("state")).toBe("GO");
    expect(form.get("pinCode")).toBe("74000-000");
    expect(form.get("country")).toBe("Brasil");
    expect(form.get("address")).toBeNull();
  });

  it("recusa quando o Gupshup responde erro com HTTP 200", async () => {
    // O painel dizia "salvo" porque só o código HTTP era conferido.
    respondWith({ status: "error", message: "vertical can't be empty" });

    await expect(
      provider.updateBusinessProfile({ appId: "app-1", appToken: "", profile: { description: "x" } }),
    ).rejects.toThrow("vertical can't be empty");
  });

  it("não chama o provedor quando não há nada preenchido", async () => {
    await provider.updateBusinessProfile({ appId: "app-1", appToken: "", profile: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lê o perfil traduzindo os nomes do Gupshup de volta", async () => {
    respondWith({
      status: "success",
      profile: {
        addressLine1: "Rua das Flores, 100",
        city: "Goiânia",
        desc: "Pizzaria artesanal",
        profileEmail: "contato@empresa.com.br",
        vertical: "RESTAURANT",
      },
    });

    const profile = await provider.getBusinessProfile({ appId: "app-1", appToken: "" });

    expect(profile).toEqual(
      expect.objectContaining({
        addressLine1: "Rua das Flores, 100",
        city: "Goiânia",
        description: "Pizzaria artesanal",
        email: "contato@empresa.com.br",
        vertical: "RESTAURANT",
      }),
    );
  });
});
