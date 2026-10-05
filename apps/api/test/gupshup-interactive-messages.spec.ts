import { GupshupWhatsAppProvider } from "../src/messaging/providers/gupshup-whatsapp.provider";

describe("mensagens interativas e contato do Gupshup", () => {
  const ORIGINAL_ENV = { ...process.env };
  const params = {
    appId: "app-1",
    appToken: "token-teste",
    appName: "chegowiainstitucional",
    source: "556231425344",
    to: "5562999998888",
  };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function selfServe() {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    process.env.GUPSHUP_API_KEY = "chave-de-teste";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "submitted", messageId: "gs-1" }),
    });
    global.fetch = fetchMock as never;
    return { provider: new GupshupWhatsAppProvider(), fetchMock };
  }

  function sentMessage(fetchMock: jest.Mock) {
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    return JSON.parse(form.get("message") ?? "{}");
  }

  it("envia cartão de contato salvável no modo self-serve", async () => {
    const { provider, fetchMock } = selfServe();

    await provider.sendContact({ ...params, name: "ChegowIA | Atendimento humano", phone: "+55 62 2590-0295" });

    expect(sentMessage(fetchMock)).toEqual(expect.objectContaining({
      type: "contact",
      contact: expect.objectContaining({
        name: expect.objectContaining({ formattedName: "ChegowIA | Atendimento humano" }),
        phones: [expect.objectContaining({ phone: "+55 62 2590-0295", wa_id: "556225900295" })],
      }),
    }));
  });

  it("usa a lista nativa self-serve também para duas ou três opções", async () => {
    const { provider, fetchMock } = selfServe();
    await provider.sendInteractiveChoices({
      ...params,
      body: "Qual assunto você quer conhecer?",
      choices: [{ title: "Plano" }, { title: "Implantação" }],
    });
    expect(sentMessage(fetchMock)).toEqual(expect.objectContaining({
      type: "list",
      msgid: expect.any(String),
      items: [expect.objectContaining({ options: [
        expect.objectContaining({ title: "Plano" }),
        expect.objectContaining({ title: "Implantação" }),
      ] })],
    }));

    fetchMock.mockClear();
    await provider.sendInteractiveChoices({
      ...params,
      body: "Qual recurso você quer conhecer?",
      choices: ["Pedidos", "Cardápio", "Entregas", "Caixa"].map((title) => ({ title })),
    });
    const list = sentMessage(fetchMock);
    expect(list.type).toBe("list");
    expect(list.title).toBe("ChegowIA");
    expect(list.msgid).toEqual(expect.any(String));
    expect(list.items[0].options).toHaveLength(4);
    expect(list.globalButtons[0].title).toBe("Ver opções");
  });

  it("usa o formato Meta de contatos e botões no modo partner", async () => {
    process.env.GUPSHUP_MODE = "PARTNER";
    const provider = new GupshupWhatsAppProvider();
    const sendMessage = jest.fn().mockResolvedValue({ messageId: "gs-1", raw: {} });
    (provider as any).sendMessage = sendMessage;

    await provider.sendContact({ ...params, name: "ChegowIA | Atendimento humano", phone: "+55 62 2590-0295" });
    expect(sendMessage.mock.calls[0][2]).toEqual(expect.objectContaining({
      type: "contacts",
      contacts: [expect.objectContaining({ name: expect.objectContaining({ formatted_name: "ChegowIA | Atendimento humano" }) })],
    }));

    await provider.sendInteractiveChoices({
      ...params,
      body: "Quer conhecer o plano ou a implantação?",
      choices: [{ title: "Plano" }, { title: "Implantação" }],
    });
    expect(sendMessage.mock.calls[1][2].interactive).toEqual(expect.objectContaining({ type: "button" }));
  });
});
