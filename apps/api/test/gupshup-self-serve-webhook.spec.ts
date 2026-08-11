import { MessagingService } from "../src/messaging/messaging.service";

/**
 * O callback self-serve do Gupshup chega no formato v2 proprietário. Estes testes
 * fixam a tradução para o formato Meta, que é o único que o resto da central de
 * atendimento entende — e garantem que o canal seja resolvido pelo nome do app,
 * sem atravessar o isolamento entre tenants.
 */
describe("webhook self-serve do Gupshup", () => {
  const channel = {
    id: "canal-1",
    companyId: "empresa-1",
    status: "ATIVO",
    provider: "GUPSHUP",
    gupshupAppName: "chegowiaempresa1",
    config: { number: "5562999990000" },
    company: { id: "empresa-1", name: "Empresa 1", settings: { aiEnabled: false }, subscription: null },
  };

  function buildService(findUnique: jest.Mock) {
    const prisma = { messagingChannel: { findUnique, update: jest.fn().mockResolvedValue(channel) } };
    const service = new MessagingService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  it("ignora callback de aplicativo que não pertence a nenhuma empresa", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const { service } = buildService(findUnique);

    await expect(
      service.handleGupshupSelfServeWebhook({ app: "appDeOutraPlataforma", type: "message", payload: {} }),
    ).resolves.toEqual({ ignored: true });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gupshupAppName: "appDeOutraPlataforma" } }),
    );
  });

  it("ignora evento sem nome de aplicativo sem consultar o banco", async () => {
    const findUnique = jest.fn();
    const { service } = buildService(findUnique);

    await expect(service.handleGupshupSelfServeWebhook({ type: "message", payload: {} })).resolves.toEqual({
      ignored: true,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("converte mensagem de texto v2 para o formato Meta", async () => {
    const findUnique = jest.fn().mockResolvedValue(channel);
    const { service } = buildService(findUnique);
    const processed: any[] = [];
    (service as any).processMessagesChangeForChannel = jest.fn(async (_channel, value) => {
      processed.push(value);
    });

    await service.handleGupshupSelfServeWebhook({
      app: "chegowiaempresa1",
      type: "message",
      timestamp: 1_760_000_000_000,
      payload: {
        id: "gupshup-1",
        source: "5562988887777",
        type: "text",
        payload: { text: "Quero fazer um pedido" },
        sender: { phone: "5562988887777", name: "Thiago" },
      },
    });

    expect(processed).toHaveLength(1);
    expect(processed[0].messages[0]).toEqual({
      from: "5562988887777",
      id: "gupshup-1",
      // v2 envia milissegundos; a Meta usa segundos.
      timestamp: "1760000000",
      type: "text",
      text: { body: "Quero fazer um pedido" },
    });
    expect(processed[0].contacts[0]).toEqual({ profile: { name: "Thiago" }, wa_id: "5562988887777" });
  });

  it("converte resposta de botão preservando o postbackText como id da seleção", async () => {
    const findUnique = jest.fn().mockResolvedValue(channel);
    const { service } = buildService(findUnique);
    const processed: any[] = [];
    (service as any).processMessagesChangeForChannel = jest.fn(async (_channel, value) => {
      processed.push(value);
    });

    await service.handleGupshupSelfServeWebhook({
      app: "chegowiaempresa1",
      type: "message",
      timestamp: 1_760_000_000_000,
      payload: {
        id: "gupshup-2",
        source: "5562988887777",
        type: "quick_reply",
        payload: { postbackText: "chegowia:human", title: "Falar com humano" },
        sender: { phone: "5562988887777" },
      },
    });

    expect(processed[0].messages[0].interactive).toEqual({
      type: "button_reply",
      button_reply: { id: "chegowia:human", title: "Falar com humano" },
    });
  });

  it("converte evento de status v2 em statuses no formato Meta", async () => {
    const findUnique = jest.fn().mockResolvedValue(channel);
    const { service } = buildService(findUnique);
    const processed: any[] = [];
    (service as any).processMessagesChangeForChannel = jest.fn(async (_channel, value) => {
      processed.push(value);
    });

    await service.handleGupshupSelfServeWebhook({
      app: "chegowiaempresa1",
      type: "message-event",
      timestamp: 1_760_000_000_000,
      payload: { id: "gupshup-3", type: "delivered", destination: "5562988887777" },
    });

    expect(processed[0].statuses).toEqual([
      { id: "gupshup-3", status: "delivered", recipient_id: "5562988887777", errors: undefined },
    ]);
  });

  it("descarta eventos que não são mensagem nem status", async () => {
    const findUnique = jest.fn().mockResolvedValue(channel);
    const { service } = buildService(findUnique);
    (service as any).processMessagesChangeForChannel = jest.fn();

    await expect(
      service.handleGupshupSelfServeWebhook({
        app: "chegowiaempresa1",
        type: "account-event",
        payload: { type: "quality-update" },
      }),
    ).resolves.toEqual({ ignored: true });

    expect((service as any).processMessagesChangeForChannel).not.toHaveBeenCalled();
  });
});
