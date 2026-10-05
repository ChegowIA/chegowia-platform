import { ConflictException } from "@nestjs/common";
import { needsHumanSupportReferral, parseSalesAssistantReply, withSalesOverviewChoices } from "../src/messaging/platform-whatsapp.service";
import { buildPlatformWhatsAppService } from "./support/messaging-services";

describe("Canal institucional do WhatsApp", () => {
  function serviceWith(prismaOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
    const prisma = {
      messagingChannel: { findUnique: jest.fn().mockResolvedValue(null) },
      platformWhatsAppChannel: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: "canal-plataforma", ...create })),
      },
      platformWhatsAppMessage: { findMany: jest.fn().mockResolvedValue([]) },
      platformUsageLedger: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: "uso-plataforma", ...data })),
        update: jest.fn(),
      },
      usageRate: { findUnique: jest.fn().mockResolvedValue(null) },
      softwarePlan: {
        findFirst: jest.fn().mockResolvedValue({
          name: "ChegowIA Profissional",
          monthlyPrice: 159.9,
          features: ["Pedidos", "WhatsApp"],
        }),
      },
      ...prismaOverrides,
    };
    const meta = {
      getPhoneNumber: jest.fn().mockResolvedValue({
        id: "123456789012345",
        displayPhoneNumber: "+55 62 99999-9999",
        verifiedName: "ChegowIA",
        qualityRating: "GREEN",
      }),
      businessHasPhoneNumber: jest.fn().mockResolvedValue(true),
      subscribeAppToBusinessAccount: jest.fn().mockResolvedValue(undefined),
      ...((overrides.meta as Record<string, unknown>) ?? {}),
    };
    const gupshup = {
      isEnabled: jest.fn().mockReturnValue(true),
      mode: jest.fn().mockReturnValue("SELF_SERVE"),
      sendText: jest.fn().mockResolvedValue({ messageId: "gs-1", raw: {} }),
      sendContact: jest.fn().mockResolvedValue({ messageId: "gs-contact", raw: {} }),
      sendInteractiveChoices: jest.fn().mockResolvedValue({ messageId: "gs-choices", raw: {} }),
      ...((overrides.gupshup as Record<string, unknown>) ?? {}),
    };
    const secrets = {
      encrypt: jest.fn((value: string) => `cifrado:${value}`),
      decrypt: jest.fn(() => "token-decriptado"),
      ...((overrides.secrets as Record<string, unknown>) ?? {}),
    };
    const realtime = { emitToSuperAdmins: jest.fn() };
    const instance = buildPlatformWhatsAppService({
      prisma: prisma,
      gupshup: gupshup,
      secrets: secrets,
      aiProvider: { chat: jest.fn(), ...((overrides.aiProvider as Record<string, unknown>) ?? {}) },
      realtime: realtime,
    });
    return { instance, prisma, gupshup, secrets, realtime };
  }

  it("não permite vincular ao institucional um aplicativo de empresa cliente", async () => {
    // O nome do aplicativo é o que o callback usa para achar o canal: se os dois
    // apontassem para o mesmo, conversa de cliente cairia no inbox institucional.
    const { instance } = serviceWith({
      messagingChannel: { findUnique: jest.fn().mockResolvedValue({ id: "canal-cliente" }) },
    });

    await expect(
      instance.connectGupshupManual({ appName: "chegowiaempresa1" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("só ativa o canal quando o número é informado", async () => {
    const { instance } = serviceWith();

    const pendente = await instance.connectGupshupManual({ appName: "chegowiainstitucional" });
    expect(pendente).toEqual(expect.objectContaining({ connected: false }));

    const ativo = await instance.connectGupshupManual({
      appName: "chegowiainstitucional",
      appId: "app-1",
      number: "556231425344",
    });
    expect(ativo).toEqual(expect.objectContaining({ connected: true }));
  });

  it("espelha na central institucional a mensagem enviada pelo WhatsApp Business App", async () => {
    const channel = { id: "canal-plataforma", status: "ATIVO" };
    const platformMessages = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "mensagem-1" }),
    };
    const { instance, realtime } = serviceWith({
      platformWhatsAppChannel: {
        findUnique: jest.fn().mockResolvedValue(channel),
        update: jest.fn().mockResolvedValue(channel),
      },
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "conversa-1" }),
      },
      platformWhatsAppMessage: platformMessages,
    });

    await instance.handleGupshupCoexistenceEchoesByAppId("app-1", {
      message_echoes: [{
        id: "wamid-institucional-1",
        from: "556231425344",
        to: "5562988887777",
        type: "text",
        text: { body: "Olá, posso ajudar?" },
      }],
    });

    expect(platformMessages.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        direction: "ENVIADA",
        body: "Olá, posso ajudar?",
      }),
    }));
    expect(realtime.emitToSuperAdmins).toHaveBeenCalledWith(
      "platform.whatsapp.message.sent",
      { conversationId: "conversa-1" },
    );
  });

  it("usa o preço comercial público no contexto da IA", async () => {
    const { instance } = serviceWith();

    const messages = await (instance as any).messagesForAssistant("conversa-1", {
      welcomeMessage: null,
      salesInstructions: null,
    });

    expect(messages[0].content).toContain("R$ 159,90 por mês");
    expect(messages[0].content).toContain("https://chegowia.com.br/planos");
    expect(messages[0].content).toContain("nunca peça senha, código de verificação, token, cartão ou dado sensível");
    expect(messages[0].content).toContain("+55 62 2590-0295");
    expect(messages[0].content).toContain("https://wa.me/556225900295");
    expect(messages[0].content).toContain("suporte leve");
  });

  it("encaminha pedidos explícitos de suporte humano ou avançado ao canal correto", async () => {
    expect(needsHumanSupportReferral("Preciso de suporte técnico para uma falha no sistema")).toBe(true);
    expect(needsHumanSupportReferral("Quero falar com um atendente da ChegowIA")).toBe(true);
    expect(needsHumanSupportReferral("Minha cobrança está com erro")).toBe(true);
    expect(needsHumanSupportReferral("Não consigo entrar na minha conta")).toBe(true);
    expect(needsHumanSupportReferral("Sou pessoa jurídica e quero conhecer o plano")).toBe(false);

    const { instance, gupshup } = serviceWith();
    const sendText = jest.fn().mockResolvedValue(undefined);
    const persistOutbound = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;
    (instance as any).persistOutbound = persistOutbound;
    const conversation = { id: "conversa-1", customerPhone: "5562999998888" };
    const channel = { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" };
    await (instance as any).referToHumanSupport(conversation, channel);

    expect(sendText).toHaveBeenCalledWith(
      conversation,
      channel,
      expect.stringContaining("https://wa.me/556225900295"),
      undefined,
      "text",
    );
    expect(gupshup.sendContact).toHaveBeenCalledWith(expect.objectContaining({
      to: "5562999998888",
      phone: "+55 62 2590-0295",
      name: "ChegowIA | Atendimento humano",
    }));
    expect(persistOutbound).toHaveBeenCalledWith(conversation, channel, expect.objectContaining({ type: "contact" }));
  });

  it("aceita resposta estruturada e filtra opções inválidas ou repetidas", () => {
    expect(parseSalesAssistantReply(JSON.stringify({
      text: "Qual tipo de operação você tem?",
      choices: [
        { title: "Pizzaria" },
        { title: "pizzaria" },
        { title: "Restaurante", description: "Atendimento e delivery" },
      ],
      humanSupport: false,
    }))).toEqual({
      text: "Qual tipo de operação você tem?",
      choices: [{ title: "Pizzaria" }, { title: "Restaurante", description: "Atendimento e delivery" }],
      humanSupport: false,
    });
    expect(parseSalesAssistantReply("Resposta em texto livre")?.choices).toEqual([]);
    expect(parseSalesAssistantReply(null)).toBeNull();
    expect(parseSalesAssistantReply("       ")).toBeNull();
    expect(parseSalesAssistantReply("{\"choices\":[]}")).toBeNull();
    expect(parseSalesAssistantReply("{\"text\":")).toBeNull();
  });

  it("extrai o JSON misturado a texto sem mostrar código e preserva as opções", () => {
    const text = "As opções são as áreas abaixo. Qual você quer detalhar?";
    const choices = ["Pedidos e delivery", "Mesas e cozinha", "Caixa e fiscal", "Entregas e frete", "Planos e teste"]
      .map((title) => ({ title }));
    const mixed = `${text}\n\n${JSON.stringify({ text, choices, humanSupport: false })}`;

    expect(parseSalesAssistantReply(mixed)).toEqual({ text, choices, humanSupport: false });
    expect(parseSalesAssistantReply(`${text}\n\n{\"text\":\"cortado\"`)).toBeNull();
    expect(parseSalesAssistantReply(JSON.stringify({ text: `${text} {\"text\":\"não envie\"}`, choices: [] }))).toBeNull();
  });

  it("oferece menu automaticamente ao listar recursos, sem exigir que o cliente peça botões", () => {
    const reply = { text: "Tem pedidos, cardápio, mesas e entregas.", choices: [], humanSupport: false };
    const enriched = withSalesOverviewChoices(reply, "Quais recursos vocês têm?");

    expect(enriched.text).toContain("Qual área você quer explorar primeiro?");
    expect(enriched.choices.map((choice) => choice.title)).toEqual([
      "Pedidos e delivery", "Cardápio", "Mesas e cozinha", "Entregas e frete", "Planos e teste",
    ]);
    expect(withSalesOverviewChoices(reply, "Quanto custa?").choices).toEqual([]);
  });

  it("envia lista nativa para resposta com texto e JSON misturados", async () => {
    const text = "As opções são as áreas abaixo. Qual você quer detalhar?";
    const choices = ["Pedidos e delivery", "Mesas e cozinha", "Caixa e fiscal", "Entregas e frete", "Planos e teste"]
      .map((title) => ({ title }));
    const chat = jest.fn().mockResolvedValue({ content: `${text}\n\n${JSON.stringify({ text, choices, humanSupport: false })}` });
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, { aiProvider: { chat } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([
      { role: "system", content: "Contexto" }, { role: "user", content: "Manda caixa de opções, por favor" },
    ]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    (instance as any).persistOutbound = jest.fn();
    const sendText = jest.fn();
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(gupshup.sendInteractiveChoices).toHaveBeenCalledWith(expect.objectContaining({ body: text, choices }));
    expect(sendText).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("envia explicação longa inteira e depois o menu, sem truncar o texto", async () => {
    const longText = `Pedidos, cardápio, mesas e entregas. ${"Detalhes da operação para quem está conhecendo o sistema. ".repeat(22)}`;
    const chat = jest.fn().mockResolvedValue({ content: JSON.stringify({ text: longText, choices: [], humanSupport: false }) });
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, { aiProvider: { chat } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([
      { role: "system", content: "Contexto" }, { role: "user", content: "Quais recursos?" },
    ]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    (instance as any).persistOutbound = jest.fn();
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.stringContaining("Detalhes da operação"), undefined, "ai",
    );
    expect(gupshup.sendInteractiveChoices).toHaveBeenCalledWith(expect.objectContaining({
      body: "Qual área da ChegowIA você quer explorar primeiro?",
      choices: expect.arrayContaining([{ title: "Cardápio", description: "Produtos, tamanhos e adicionais" }]),
    }));
  });

  it("envia botões nativos quando a IA apresenta uma escolha real", async () => {
    const chat = jest.fn().mockResolvedValue({ content: JSON.stringify({
      text: "Você quer conhecer o plano ou ver como começar?",
      choices: [{ title: "Conhecer plano" }, { title: "Como começar" }],
      humanSupport: false,
    }) });
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, { aiProvider: { chat } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    const persistOutbound = jest.fn().mockResolvedValue(undefined);
    (instance as any).persistOutbound = persistOutbound;
    const sendText = jest.fn();
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(chat).toHaveBeenCalledWith([], undefined, {
      thinking: false, maxTokens: 1000,
    });
    expect(gupshup.sendInteractiveChoices).toHaveBeenCalledWith(expect.objectContaining({
      choices: [{ title: "Conhecer plano" }, { title: "Como começar" }],
    }));
    expect(persistOutbound).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ type: "quick_reply" }));
    expect(sendText).not.toHaveBeenCalled();
  });

  it("refaz resposta vazia sem repetir a frase genérica para a pergunta do cliente", async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce({ content: "                    ", requestId: "req-vazio" })
      .mockResolvedValueOnce({ content: "Nossa missão é ajudar negócios de alimentação a organizar pedidos, atendimento e entregas em um só lugar.", requestId: "req-recuperado" });
    const { instance } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, { aiProvider: { chat } });
    const history = [
      { role: "system", content: "Contexto da ChegowIA" },
      { role: "user", content: "Qual a missão de vocês?" },
    ];
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue(history);
    const recordUsage = jest.fn();
    (instance as any).recordPlatformAiUsage = recordUsage;
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0][0].content).toContain("responda diretamente à última mensagem");
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.stringContaining("Nossa missão é ajudar negócios"), undefined, "ai",
    );
  });

  it("rejeita resposta antiga repetida e recupera um menu útil", async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ text: "Posso explicar os planos, os recursos da ChegowIA ou ajudar você a começar. O que gostaria de saber?", choices: [], humanSupport: false }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ text: "O sistema reúne pedidos, cardápio, mesas, entregas e caixa. Qual área quer ver primeiro?", choices: [{ title: "Pedidos" }, { title: "Cardápio" }], humanSupport: false }) });
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, { aiProvider: { chat } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([
      { role: "system", content: "Contexto" }, { role: "user", content: "Quais recursos?" },
    ]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    (instance as any).persistOutbound = jest.fn();

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(gupshup.sendInteractiveChoices).toHaveBeenCalledWith(expect.objectContaining({
      choices: [{ title: "Pedidos" }, { title: "Cardápio" }],
    }));
  });

  it("encerra a automação e oferece contato humano se as duas respostas forem inválidas", async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce({ content: "{\"text\":" })
      .mockResolvedValueOnce({ content: null });
    const update = jest.fn().mockResolvedValue({});
    const { instance, gupshup, realtime } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
        update,
      },
    }, { aiProvider: { chat } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([
      { role: "system", content: "Contexto" }, { role: "user", content: "Quais os recursos?" },
    ]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    (instance as any).persistOutbound = jest.fn();
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conversa-1" },
      data: expect.objectContaining({ mode: "HUMANO" }),
    }));
    expect(realtime.emitToSuperAdmins).toHaveBeenCalledWith(
      "platform.whatsapp.conversation.updated", { conversationId: "conversa-1" },
    );
    expect(sendText).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.stringContaining("https://wa.me/556225900295"), undefined, "ai",
    );
    expect(gupshup.sendContact).toHaveBeenCalledTimes(1);
  });

  it("desativa a automação se o provedor de IA falhar", async () => {
    const update = jest.fn().mockResolvedValue({});
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: { update },
    }, { aiProvider: { chat: jest.fn().mockRejectedValue(new Error("IA indisponível")) } });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([
      { role: "system", content: "Contexto" }, { role: "user", content: "Como começo?" },
    ]);
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;
    (instance as any).persistOutbound = jest.fn();

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "HUMANO" }),
    }));
    expect(sendText).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.stringContaining("indisponível neste instante"), undefined, "text",
    );
    expect(gupshup.sendContact).toHaveBeenCalledTimes(1);
  });

  it("mantém opções em texto se o menu interativo falhar no provedor", async () => {
    const { instance } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, {
      aiProvider: { chat: jest.fn().mockResolvedValue({ content: JSON.stringify({
        text: "Qual assunto prefere?",
        choices: [{ title: "Plano" }, { title: "Cardápio" }],
        humanSupport: false,
      }) }) },
      gupshup: { sendInteractiveChoices: jest.fn().mockRejectedValue(new Error("menu indisponível")) },
    });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "Qual assunto prefere?\n\n1. Plano\n2. Cardápio",
      undefined,
      "ai",
    );
  });

  it("acrescenta o contato oficial se a IA sinalizar atendimento humano sem o link", async () => {
    const { instance, gupshup } = serviceWith({
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" }),
      },
    }, {
      aiProvider: { chat: jest.fn().mockResolvedValue({ content: JSON.stringify({
        text: "Esse caso precisa de análise da equipe.",
        choices: [{ title: "Plano" }, { title: "Cardápio" }],
        humanSupport: true,
      }) }) },
    });
    (instance as any).messagesForAssistant = jest.fn().mockResolvedValue([]);
    (instance as any).recordPlatformAiUsage = jest.fn();
    (instance as any).persistOutbound = jest.fn().mockResolvedValue(undefined);
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;

    await (instance as any).answerWithSalesAssistant(
      { id: "conversa-1" },
      { id: "canal-1", status: "ATIVO", gupshupAppName: "institucional" },
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining("https://wa.me/556225900295"),
      undefined,
      "ai",
    );
    expect(gupshup.sendContact).toHaveBeenCalledTimes(1);
    expect(gupshup.sendInteractiveChoices).not.toHaveBeenCalled();
  });

  it("não aciona a IA comercial quando chega um pedido de suporte avançado pelo webhook", async () => {
    const conversation = { id: "conversa-1", customerPhone: "5562999998888", mode: "VIRTUAL" };
    const platformMessages = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "mensagem-1" }),
    };
    const { instance, gupshup } = serviceWith({
      platformWhatsAppMessage: platformMessages,
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(conversation),
      },
      platformOutreachTarget: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const sendText = jest.fn().mockResolvedValue(undefined);
    (instance as any).sendText = sendText;
    (instance as any).persistOutbound = jest.fn().mockResolvedValue(undefined);
    const answerWithSalesAssistant = jest.spyOn(instance as any, "answerWithSalesAssistant");

    await (instance as any).processIncomingMessage(
      { id: "canal-1", automationEnabled: true, status: "ATIVO", gupshupAppName: "institucional" },
      [],
      { id: "wamid-suporte", from: "5562999998888", type: "text", text: { body: "Preciso de suporte avançado" } },
      {},
    );

    expect(platformMessages.create).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      conversation,
      expect.objectContaining({ id: "canal-1" }),
      expect.stringContaining("+55 62 2590-0295"),
      undefined,
      "text",
    );
    expect(answerWithSalesAssistant).not.toHaveBeenCalled();
    expect(gupshup.sendContact).toHaveBeenCalledTimes(1);
  });

  it("contabiliza a IA comercial como custo da plataforma, sem companyId", async () => {
    const { instance, prisma } = serviceWith();

    await (instance as any).recordPlatformAiUsage("canal-plataforma", {
      requestId: "req-comercial-1",
      usage: { inputTokens: 100, cachedInputTokens: 20, uncachedInputTokens: 80, outputTokens: 30 },
    });

    expect(prisma.platformUsageLedger.create).toHaveBeenCalledTimes(3);
    expect(prisma.platformUsageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ channelId: "canal-plataforma" }),
    }));
    expect(JSON.stringify(prisma.platformUsageLedger.create.mock.calls)).not.toContain("companyId");
  });
});
