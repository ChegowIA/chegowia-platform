import { BadRequestException } from "@nestjs/common";
import { janelaDeTextoLivreAberta } from "../src/messaging/platform-whatsapp.service";
import { buildPlatformWhatsAppService } from "./support/messaging-services";

/**
 * Abertura de conversa por iniciativa nossa.
 *
 * A API oficial do WhatsApp só aceita texto livre nas 24h seguintes à última
 * mensagem *da pessoa*. Fora disso, apenas modelo aprovado pela Meta. Errar essa
 * escolha não dá erro na tela: o provedor aceita a requisição, não entrega a
 * mensagem, e o disparo parece ter funcionado.
 */
describe("janela de texto livre", () => {
  const agora = new Date("2026-08-20T12:00:00Z");

  it("conversa sem resposta da pessoa está fechada", () => {
    expect(janelaDeTextoLivreAberta({ lastInboundAt: null }, agora)).toBe(false);
    expect(janelaDeTextoLivreAberta(null, agora)).toBe(false);
  });

  it("resposta recente abre a janela", () => {
    const cincoHorasAntes = new Date(agora.getTime() - 5 * 60 * 60 * 1000);
    expect(janelaDeTextoLivreAberta({ lastInboundAt: cincoHorasAntes }, agora)).toBe(true);
  });

  it("resposta de mais de 24h fecha a janela de novo", () => {
    const ontem = new Date(agora.getTime() - 25 * 60 * 60 * 1000);
    expect(janelaDeTextoLivreAberta({ lastInboundAt: ontem }, agora)).toBe(false);
  });
});

function construir(opcoes: {
  canal?: Record<string, unknown> | null;
  conversa?: Record<string, unknown> | null;
  bloqueio?: Record<string, unknown> | null;
} = {}) {
  const canal = opcoes.canal === undefined
    ? {
      id: "canal-1",
      status: "ATIVO",
      gupshupAppName: "chegowia",
      gupshupAppId: "app-1",
      config: { number: "5562990000000" },
      outreachTemplateId: "modelo-1",
      outreachTemplateBody: "Oi {{1}}, aqui é a ChegowIA. Posso te mostrar como a gente ajuda?",
      outreachTemplateParams: ["nome"],
    }
    : opcoes.canal;

  const conversas = {
    findUnique: jest.fn().mockResolvedValue(opcoes.conversa ?? null),
    create: jest.fn().mockResolvedValue({ id: "conv-1", customerPhone: "5562999998888", lastInboundAt: null }),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma: any = {
    platformWhatsAppChannel: { findUnique: jest.fn().mockResolvedValue(canal), update: jest.fn().mockResolvedValue({}) },
    platformWhatsAppConversation: conversas,
    platformOutreachBlock: { findUnique: jest.fn().mockResolvedValue(opcoes.bloqueio ?? null) },
    platformWhatsAppMessage: { create: jest.fn().mockResolvedValue({ id: "msg-1" }) },
    platformUsageLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    usageRate: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: "u-1", name: "Thiago" }) },
  };
  const gupshup = {
    sendTemplate: jest.fn().mockResolvedValue({ messageId: "prov-1", raw: {} }),
    sendText: jest.fn().mockResolvedValue({ messageId: "prov-2", raw: {} }),
  };
  const service = buildPlatformWhatsAppService({
    prisma,
    gupshup,
    secrets: { decrypt: jest.fn() },
    realtime: { emitToSuperAdmins: jest.fn() },
  }) as any;
  // O token de app só existe no modo partner; no self-serve o envio usa a apikey.
  service.gupshupAppTokenFor = jest.fn().mockResolvedValue("token");
  return { service, prisma, gupshup, conversas };
}

describe("abrir conversa com um número", () => {
  it("número novo recebe o modelo aprovado, não o texto digitado", async () => {
    const { service, gupshup } = construir();

    const resultado = await service.openConversationWith({
      phone: "5562999998888",
      name: "Pizzaria do Zé",
      text: "Oi, tudo bem?",
      mode: "HUMANO",
    });

    expect(resultado.via).toBe("modelo");
    expect(gupshup.sendText).not.toHaveBeenCalled();
    expect(gupshup.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "modelo-1",
      variables: ["Pizzaria do Zé"],
    }));
  });

  it("o texto que a pessoa recebeu fica no histórico", async () => {
    // Sem isso o inbox começaria pela resposta dela, e quem fosse atender não
    // saberia o que foi dito antes.
    const { service, prisma } = construir();

    await service.openConversationWith({ phone: "5562999998888", name: "Zé", mode: "VIRTUAL" });

    expect(prisma.platformWhatsAppMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "template",
        body: "Oi Zé, aqui é a ChegowIA. Posso te mostrar como a gente ajuda?",
      }),
    }));
  });

  it("contato sem nome usa o tratamento reserva, porque variável vazia é recusada", async () => {
    const { service, gupshup } = construir();

    await service.openConversationWith({
      phone: "5562999998888",
      name: null,
      fallbackName: "tudo bem",
      mode: "VIRTUAL",
    });

    expect(gupshup.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ variables: ["tudo bem"] }));
  });

  it("dentro da janela de 24h manda o texto livre", async () => {
    const { service, gupshup } = construir({
      conversa: {
        id: "conv-1",
        customerPhone: "5562999998888",
        lastInboundAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const resultado = await service.openConversationWith({
      phone: "5562999998888",
      text: "Passando para saber se ficou alguma dúvida.",
      mode: "HUMANO",
    });

    expect(resultado.via).toBe("texto");
    expect(gupshup.sendTemplate).not.toHaveBeenCalled();
  });

  it("sem modelo cadastrado a recusa explica o motivo", async () => {
    const { service } = construir({
      canal: {
        id: "canal-1",
        status: "ATIVO",
        gupshupAppName: "chegowia",
        config: { number: "5562990000000" },
        outreachTemplateId: null,
        outreachTemplateName: null,
      },
    });

    await expect(service.openConversationWith({ phone: "5562999998888", mode: "HUMANO" }))
      .rejects.toThrow(/janela de 24 horas/);
  });

  it("quem pediu para não receber não é abordado nem à mão", async () => {
    const { service, gupshup } = construir({ bloqueio: { phone: "5562999998888" } });

    await expect(service.openConversationWith({ phone: "5562999998888", mode: "HUMANO" }))
      .rejects.toThrow(BadRequestException);
    await expect(service.openConversationWith({ phone: "5562999998888", mode: "HUMANO" }))
      .rejects.toThrow(/\(62\) 99999-8888 pediu para não receber/);
    expect(gupshup.sendTemplate).not.toHaveBeenCalled();
  });

  it("número inválido não chega ao provedor", async () => {
    const { service, gupshup } = construir();

    await expect(service.startConversation("u-1", { phone: "0000000000" }))
      .rejects.toThrow(/Número inválido/);
    expect(gupshup.sendTemplate).not.toHaveBeenCalled();
  });

  it("conversa aberta à mão nasce com a equipe, não com o assistente", async () => {
    const { service, conversas } = construir();

    await service.startConversation("u-1", { phone: "(62) 99999-8888", name: "Zé" });

    expect(conversas.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "HUMANO", customerPhone: "5562999998888" }),
    }));
  });
});

describe("resposta de quem foi abordado", () => {
  function construirRegistro(alvos: any[], texto: string) {
    const prisma: any = {
      platformOutreachTarget: {
        findMany: jest.fn().mockResolvedValue(alvos),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      platformOutreachCampaign: { update: jest.fn().mockResolvedValue({}) },
      platformOutreachBlock: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = buildPlatformWhatsAppService({ prisma }) as any;
    return {
      prisma,
      executar: () => service.registrarRespostaDeProspeccao(
        { id: "conv-1", customerPhone: "5562999998888" },
        texto,
      ),
    };
  }

  it("primeira resposta conta na taxa de resposta do disparo", async () => {
    const { prisma, executar } = construirRegistro(
      [{ id: "a-1", campaignId: "camp-1", status: "ENVIADO" }],
      "quanto custa?",
    );

    const resultado = await executar();

    expect(resultado).toEqual({ pediuSaida: false, deProspeccao: true });
    expect(prisma.platformOutreachTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RESPONDEU", conversationId: "conv-1" }),
    }));
    expect(prisma.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { repliedCount: { increment: 1 } },
    }));
  });

  it("segunda mensagem da mesma pessoa não conta de novo", async () => {
    const { prisma, executar } = construirRegistro(
      [{ id: "a-1", campaignId: "camp-1", status: "RESPONDEU" }],
      "e tem taxa de adesão?",
    );

    await executar();

    expect(prisma.platformOutreachCampaign.update).not.toHaveBeenCalled();
  });

  it("pedido de saída bloqueia o número e limpa a fila de todos os disparos", async () => {
    // Valer só para a campanha em curso seria contornado pela próxima lista
    // colada, e a pessoa receberia de novo.
    const { prisma, executar } = construirRegistro(
      [{ id: "a-1", campaignId: "camp-1", status: "ENVIADO" }],
      "me tira dessa lista, por favor",
    );

    const resultado = await executar();

    expect(resultado.pediuSaida).toBe(true);
    expect(prisma.platformOutreachBlock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: "5562999998888" },
    }));
    expect(prisma.platformOutreachTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: "5562999998888", status: "PENDENTE" },
    }));
  });

  it("quem escreveu por conta própria não mexe em disparo nenhum", async () => {
    const { prisma, executar } = construirRegistro([], "oi, queria saber do sistema");

    const resultado = await executar();

    expect(resultado).toEqual({ pediuSaida: false, deProspeccao: false });
    expect(prisma.platformOutreachBlock.upsert).not.toHaveBeenCalled();
  });
});

/**
 * Resposta da equipe no inbox.
 *
 * A janela de 24h vale para qualquer conversa do canal, não só para prospecção.
 * Antes a mensagem era tentada e voltava com o erro cru do provedor dentro do
 * histórico, o que parecia falha do sistema em vez de regra do WhatsApp.
 */
describe("responder pelo inbox", () => {
  function construirEnvio(lastInboundAt: Date | null, channelKey = "chegowia-institucional") {
    const conversation = {
      id: "conv-1",
      customerPhone: "5562999998888",
      lastInboundAt,
      channel: { id: "canal-1", key: channelKey, status: "ATIVO", automationEnabled: true },
      messages: [],
    };
    const prisma: any = {
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue({
          ...conversation,
          channel: {
            id: "canal-1",
            status: "ATIVO",
            gupshupAppName: "chegowia",
            config: { number: "5562990000000" },
          },
        }),
      },
      platformWhatsAppMessage: { create: jest.fn().mockResolvedValue({ id: "msg-1" }) },
      platformWhatsAppChannel: { update: jest.fn().mockResolvedValue({}) },
      platformUsageLedger: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      usageRate: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "u-1", name: "Thiago" }) },
    };
    const gupshup = { sendText: jest.fn().mockResolvedValue({ messageId: "prov-1", raw: {} }) };
    const service = buildPlatformWhatsAppService({
      prisma,
      gupshup,
      realtime: { emitToSuperAdmins: jest.fn() },
    }) as any;
    service.gupshupAppTokenFor = jest.fn().mockResolvedValue("token");
    return { service, gupshup, prisma };
  }

  it("conversa do número de prospecção não responde pelo institucional", async () => {
    const { service, gupshup } = construirEnvio(new Date(), "chegowia-prospeccao-qr");

    await expect(service.sendHumanMessage("u-1", "conv-1", "oi")).rejects.toThrow(/não encontrada/);
    expect(gupshup.sendText).not.toHaveBeenCalled();
  });

  it("a caixa lista só conversas do número institucional", async () => {
    const { service, prisma } = construirEnvio(null);
    prisma.platformWhatsAppConversation.findMany = jest.fn().mockResolvedValue([]);

    await service.listConversations();

    expect(prisma.platformWhatsAppConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { channel: { key: "chegowia-institucional" } },
    }));
  });

  it("fora da janela recusa antes de chamar o provedor", async () => {
    const { service, gupshup } = construirEnvio(new Date(Date.now() - 30 * 60 * 60 * 1000));

    await expect(service.sendHumanMessage("u-1", "conv-1", "oi")).rejects.toThrow(/24 horas/);
    expect(gupshup.sendText).not.toHaveBeenCalled();
  });

  it("conversa que a pessoa nunca respondeu também recusa", async () => {
    const { service, gupshup } = construirEnvio(null);

    await expect(service.sendHumanMessage("u-1", "conv-1", "oi")).rejects.toThrow(/escreva primeiro/);
    expect(gupshup.sendText).not.toHaveBeenCalled();
  });

  it("dentro da janela envia normalmente", async () => {
    const { service, gupshup } = construirEnvio(new Date(Date.now() - 60 * 60 * 1000));

    await service.sendHumanMessage("u-1", "conv-1", "seguindo nossa conversa");

    expect(gupshup.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: "seguindo nossa conversa",
    }));
  });
});
