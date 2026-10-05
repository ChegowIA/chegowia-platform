import { GupshupWhatsAppProvider } from "../src/messaging/providers/gupshup-whatsapp.provider";
import { ORDER_UPDATE_TEMPLATE } from "../src/messaging/order-update-template";
import { buildMessagingService } from "./support/messaging-services";

describe("modelo padrão de andamento do pedido", () => {
  const originalEnv = { ...process.env };

  afterEach(() => { process.env = { ...originalEnv }; });

  it("usa o endpoint do app self-serve e submete o modelo Utility com exemplos", async () => {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    process.env.GUPSHUP_API_KEY = "chave-de-teste";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: "success", template: { id: "modelo-1", status: "PENDING" } }),
    });
    global.fetch = fetchMock as never;
    const provider = new GupshupWhatsAppProvider();

    const template = await provider.createUtilityTemplate({
      appId: "app-1", appToken: "", name: ORDER_UPDATE_TEMPLATE.name,
      languageCode: ORDER_UPDATE_TEMPLATE.languageCode,
      content: ORDER_UPDATE_TEMPLATE.body, example: ORDER_UPDATE_TEMPLATE.example,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.gupshup.io/wa/app/app-1/template");
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(form.get("category")).toBe("UTILITY");
    expect(form.get("content")).toBe(ORDER_UPDATE_TEMPLATE.body);
    expect(form.get("example")).toBe(ORDER_UPDATE_TEMPLATE.example);
    expect(template.status).toBe("PENDING");
  });

  it("não declara criado quando o Gupshup recusa com HTTP 200", async () => {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    process.env.GUPSHUP_API_KEY = "chave-de-teste";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: "error", message: "app not found" }),
    }) as never;
    await expect(new GupshupWhatsAppProvider().createUtilityTemplate({
      appId: "app-1", appToken: "", name: ORDER_UPDATE_TEMPLATE.name,
      languageCode: ORDER_UPDATE_TEMPLATE.languageCode,
      content: ORDER_UPDATE_TEMPLATE.body, example: ORDER_UPDATE_TEMPLATE.example,
    })).rejects.toThrow("app not found");
  });

  it("consulta o app certo e não interpreta resposta desconhecida como lista vazia", async () => {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    process.env.GUPSHUP_API_KEY = "chave-de-teste";
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: "success", templates: [{
        id: "modelo-1", elementName: ORDER_UPDATE_TEMPLATE.name,
        languageCode: "pt_BR", category: "UTILITY", status: "APPROVED", data: ORDER_UPDATE_TEMPLATE.body,
      }] }),
    }).mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ status: "success", unexpected: true }),
    });
    global.fetch = fetchMock as never;
    const provider = new GupshupWhatsAppProvider();
    expect(await provider.listTemplates({ appId: "app-1", appToken: "" })).toEqual([
      expect.objectContaining({ id: "modelo-1", status: "APPROVED" }),
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.gupshup.io/wa/app/app-1/template?pageNo=0&pageSize=100");
    await expect(provider.listTemplates({ appId: "app-1", appToken: "" })).rejects.toThrow("formato inesperado");
  });

  function setup(existing: any[] = [], state: string | null = null) {
    process.env.GUPSHUP_MODE = "SELF_SERVE";
    const channel = {
      id: "canal-1", companyId: "empresa-1", provider: "GUPSHUP", status: "ATIVO",
      gupshupAppId: "app-1", gupshupAppName: "pizzaria-1",
      config: { number: "5562999999999", orderUpdateTemplateState: state },
    };
    const db = {
      messagingChannel: {
        findUnique: jest.fn().mockResolvedValue(channel),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...channel, ...data })),
      },
    };
    const provider = {
      isEnabled: jest.fn().mockReturnValue(true),
      mode: jest.fn().mockReturnValue("SELF_SERVE"),
      listTemplates: jest.fn().mockResolvedValue(existing),
      createUtilityTemplate: jest.fn().mockResolvedValue({
        id: "modelo-1", name: ORDER_UPDATE_TEMPLATE.name, languageCode: "pt_BR",
        category: "UTILITY", status: "PENDING", content: ORDER_UPDATE_TEMPLATE.body,
      }),
    };
    return {
      service: buildMessagingService({ prisma: db, gupshup: provider, secrets: { isConfigured: () => true } }),
      db, provider,
    };
  }

  it("cria o modelo somente quando não existe e mantém avisos desligados durante aprovação", async () => {
    const { service, db, provider } = setup();
    const result = await service.syncOrderNotificationsTemplate("empresa-1");
    expect(provider.createUtilityTemplate).toHaveBeenCalledTimes(1);
    expect(db.messagingChannel.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { config: expect.objectContaining({ orderUpdateTemplateState: "PENDING", orderUpdateTemplateId: null }) },
    }));
    expect(result.orderNotifications.configured).toBe(false);
  });

  it("reutiliza o modelo aprovado do WABA sem submeter outro", async () => {
    const existing = [{
      id: "modelo-aprovado", name: ORDER_UPDATE_TEMPLATE.name, languageCode: "pt_BR",
      category: "UTILITY", status: "APPROVED", content: ORDER_UPDATE_TEMPLATE.body,
    }];
    const { service, provider } = setup(existing, "PENDING");
    const result = await service.syncOrderNotificationsTemplate("empresa-1");
    expect(provider.createUtilityTemplate).not.toHaveBeenCalled();
    expect(result.orderNotifications).toEqual(expect.objectContaining({
      configured: true, templateId: "modelo-aprovado", state: "APPROVED",
    }));
  });

  it("não vincula um modelo homônimo de categoria ou conteúdo diferente", async () => {
    const existing = [{
      id: "modelo-errado", name: ORDER_UPDATE_TEMPLATE.name, languageCode: "pt_BR",
      category: "MARKETING", status: "APPROVED", content: "Promoção imperdível",
    }];
    const { service } = setup(existing);
    const result = await service.syncOrderNotificationsTemplate("empresa-1");
    expect(result.orderNotifications).toEqual(expect.objectContaining({ configured: false, state: "INVALID" }));
  });
});
