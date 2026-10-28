import { PlatformOutreachService } from "../src/messaging/platform-outreach.service";

function fixture(overrides: Record<string, unknown> = {}) {
  const campaign: any = {
    id: "c1", channelId: "ch1", sourceType: "XLSX", status: "RASCUNHO",
    approvedAt: new Date(), preparationRequestedAt: null, startedAt: null,
    ...overrides,
  };
  const channel = { id: "ch1" };
  const db: any = {
    platformOutreachCampaign: {
      findUnique: jest.fn().mockResolvedValue(campaign), findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(Object.assign(campaign, data))),
    },
    platformOutreachTarget: {
      count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    platformWhatsAppChannel: { findUnique: jest.fn().mockResolvedValue(channel) },
    platformOutreachSenderState: {
      findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    platformOutreachBlock: { findUnique: jest.fn().mockResolvedValue(null) },
    platformOutreachAttempt: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    platformUsageLedger: { findUnique: jest.fn().mockResolvedValue({ providerAmount: 0.326777 }) },
    usageRate: {
      findUnique: jest.fn().mockResolvedValue({ metric: "WHATSAPP_TEMPLATE_MARKETING", providerUnitCost: 0.326777, unitSize: 1 }),
      findMany: jest.fn().mockResolvedValue([
        { metric: "IA_TOKENS_ENTRADA", providerUnitCost: 0.710822, unitSize: 1_000_000 },
        { metric: "IA_TOKENS_SAIDA", providerUnitCost: 1.421644, unitSize: 1_000_000 },
      ]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  db.$transaction = jest.fn().mockImplementation((fn: any) => fn(db));
  const whatsapp = {
    outreachChannelStatus: jest.fn().mockResolvedValue({
      channelId: "ch1", connected: true, phone: "5562990000000", template: { approved: true },
    }),
    openConversationWith: jest.fn().mockResolvedValue({
      conversation: { id: "conv-1" }, message: { providerMessageId: "wamid-1" }, via: "modelo",
    }),
  };
  const service: any = Object.create(PlatformOutreachService.prototype);
  Object.assign(service, {
    prisma: db, whatsapp, realtime: { emitToSuperAdmins: jest.fn() },
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }, processando: false,
  });
  return { service, db, whatsapp, campaign };
}

describe("fila segura de prospecção", () => {
  it("rejeita criação por lista colada", async () => {
    const { service } = fixture();
    await expect(service.criarCampanha("admin", { name: "Lista", contacts: "62999998888" }))
      .rejects.toThrow(/importação XLSX/);
  });

  it("não inicia campanha sem aprovação", async () => {
    const { service } = fixture({ sourceType: "LEGACY", approvedAt: null });
    await expect(service.iniciar("c1")).rejects.toThrow(/aprove a campanha/);
  });

  it("não inicia com um lead sem opt-in ou mensagem aprovada", async () => {
    const { service, db, whatsapp } = fixture();
    db.platformOutreachTarget.count.mockResolvedValue(1);
    await expect(service.iniciar("c1")).rejects.toThrow(/ainda não estão autorizados/);
    expect(whatsapp.openConversationWith).not.toHaveBeenCalled();
  });

  it("exige o número oficial conectado antes de iniciar", async () => {
    const { service, whatsapp } = fixture();
    whatsapp.outreachChannelStatus.mockResolvedValue({ channelId: "ch1", connected: false, template: { approved: true } });
    await expect(service.iniciar("c1")).rejects.toThrow(/Conecte o WhatsApp institucional/);
  });

  it("exige o modelo aprovado pela Meta antes de iniciar", async () => {
    const { service, whatsapp } = fixture();
    whatsapp.outreachChannelStatus.mockResolvedValue({ channelId: "ch1", connected: true, template: { approved: false } });
    await expect(service.iniciar("c1")).rejects.toThrow(/aprovado pela Meta/);
  });

  it("inicia somente depois de conferir o número e a trava", async () => {
    const { service, db, whatsapp } = fixture();
    await service.iniciar("c1");
    expect(whatsapp.outreachChannelStatus).toHaveBeenCalled();
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIANDO" }),
    }));
  });

  const target = {
    id: "t1", phone: "5562999998888", status: "PENDENTE", attempts: 0,
    consentStatus: "CONFIRMADO", approvalStatus: "APROVADO", generationStatus: "PRONTO",
    proposal: "pizzas e delivery", messageText: "Oi, Pizzaria X!",
    name: "Pizzaria X", company: "Pizzaria X", city: "Goiânia",
    templateVariables: ["Pizzaria X", "pizzas e delivery", "Goiânia"],
  };
  function reservation() {
    const fx = fixture({ status: "ENVIANDO" });
    fx.db.platformOutreachSenderState.findUnique.mockResolvedValue({
      inFlightTargetId: null, nextAllowedAt: null,
    });
    fx.db.platformOutreachTarget.findUnique.mockResolvedValue(target);
    return fx;
  }

  it("não reserva envio sem autorização", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, consentStatus: "NAO_VERIFICADO" });
    expect(await service.reservarEnvio(campaign, target)).toBeNull();
    expect(db.platformOutreachAttempt.create).not.toHaveBeenCalled();
  });

  it("a trava registra 60 segundos entre inícios de tentativas", async () => {
    const { service, db, campaign } = reservation();
    expect(await service.reservarEnvio(campaign, target)).toEqual(expect.any(String));
    const started = db.platformOutreachAttempt.create.mock.calls[0][0].data.startedAt as Date;
    const next = db.platformOutreachSenderState.update.mock.calls[0][0].data.nextAllowedAt as Date;
    expect(next.getTime() - started.getTime()).toBe(60_000);
  });

  it("impede outra campanha do mesmo remetente durante os 60 segundos persistidos", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachSenderState.findUnique.mockResolvedValue({
      inFlightTargetId: null, nextAllowedAt: new Date(Date.now() + 45_000),
    });
    const otherCampaign = { ...campaign, id: "c2", channelId: campaign.channelId };
    expect(await service.reservarEnvio(otherCampaign, target)).toBeNull();
    expect(db.platformOutreachAttempt.create).not.toHaveBeenCalled();
  });

  it("não repete uma tentativa reservada após reinício do worker", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachSenderState.findUnique.mockResolvedValue({
      inFlightTargetId: "t1", inFlightAt: new Date(Date.now() - 120_000), nextAllowedAt: new Date(0),
    });
    expect(await service.reservarEnvio(campaign, target)).toBeNull();
    expect(db.platformOutreachAttempt.create).not.toHaveBeenCalled();
  });

  it("não reserva o mesmo telefone se já houve tentativa", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachTarget.findFirst.mockResolvedValue({ id: "old" });
    expect(await service.reservarEnvio(campaign, target)).toBeNull();
    expect(db.platformOutreachAttempt.create).not.toHaveBeenCalled();
  });

  it("envia o modelo aprovado com as variáveis do lead e abre a conversa com a IA", async () => {
    const { service, db, campaign, whatsapp } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(whatsapp.openConversationWith).toHaveBeenCalledWith(expect.objectContaining({
      phone: target.phone, text: null, mode: "VIRTUAL",
      variables: ["Pizzaria X", "pizzas e delivery", "Goiânia"],
    }));
    expect(db.platformOutreachTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIADO", conversationId: "conv-1" }),
    }));
    expect(db.platformOutreachAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIADA", providerMessageId: "wamid-1" }),
    }));
    expect(db.platformOutreachSenderState.updateMany).toHaveBeenCalled();
  });

  it("recusa do Gupshup pausa a campanha, não reenvia o lead e libera a trava", async () => {
    const { service, db, campaign, whatsapp } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    whatsapp.openConversationWith.mockRejectedValue(new Error("Template not approved"));
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(db.platformOutreachTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FALHOU" }),
    }));
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSADA", pausedReason: expect.stringContaining("Template not approved") }),
    }));
    expect(db.platformOutreachSenderState.updateMany).toHaveBeenCalled();
  });

  it("não envia lead sem as três variáveis do modelo", async () => {
    const { service, db, campaign, whatsapp } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO", templateVariables: null });
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(whatsapp.openConversationWith).not.toHaveBeenCalled();
    expect(db.platformOutreachAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "NAO_ENVIADA" }),
    }));
  });

  it("não chama WhatsApp se a campanha foi pausada após reservar", async () => {
    const { service, db, campaign, whatsapp } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    db.platformOutreachCampaign.findUnique.mockResolvedValue({ ...campaign, status: "PAUSADA" });
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(whatsapp.openConversationWith).not.toHaveBeenCalled();
    expect(db.platformOutreachAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "NAO_ENVIADA" }),
    }));
    expect(db.platformOutreachSenderState.updateMany).toHaveBeenCalled();
  });

  it("avança a fila de madrugada e no domingo, sem janela de horário", async () => {
    const { service, db, campaign } = fixture({ status: "ENVIANDO", respectBusinessHours: true, dailyLimit: 200 });
    await service.avancarCampanha(campaign, new Date("2026-10-25T06:00:00Z"));
    expect(db.platformOutreachTarget.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "PENDENTE" }),
    }));
  });

  it("apagar esconde o disparo sem perder o histórico de envios", async () => {
    const { service, db } = fixture({ status: "CANCELADA" });
    db.platformOutreachTarget.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    await service.excluir("c1");
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deletedAt: expect.any(Date), status: "CANCELADA" }),
    }));
    expect(db.platformOutreachCampaign.delete).toBeUndefined();
    await expect(service.iniciar("c1")).rejects.toThrow(/não encontrado/);
  });

  it("não apaga disparo enviando", async () => {
    const { service, db } = fixture({ status: "ENVIANDO" });
    await expect(service.excluir("c1")).rejects.toThrow(/Pause ou cancele/);
    expect(db.platformOutreachCampaign.update).not.toHaveBeenCalled();
  });

  it("cada envio soma ao gasto o custo registrado da Meta + Gupshup", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(db.platformUsageLedger.findUnique).toHaveBeenCalledWith({ where: { externalReference: "platform-whatsapp:wamid-1" } });
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sentCount: { increment: 1 }, spentAmount: { increment: 0.326777 } }),
    }));
  });

  it("sem registro de consumo usa a tarifa de marketing, para o envio nunca ficar de fora", async () => {
    const { service, db, campaign } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    db.platformUsageLedger.findUnique.mockResolvedValue(null);
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ spentAmount: { increment: 0.326777 } }),
    }));
  });

  it("pausa sozinha quando o gasto alcança o teto, sem enviar", async () => {
    const { service, db, campaign, whatsapp } = fixture({ status: "ENVIANDO", dailyLimit: 200, spendLimit: 10, spentAmount: 9.9 });
    db.platformOutreachTarget.groupBy.mockResolvedValue([{ campaignId: "c1", _count: { _all: 3 }, _sum: { aiInputTokens: 200_000, aiOutputTokens: 0 } }]);
    await service.avancarCampanha(campaign, new Date());
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSADA", pausedReason: expect.stringContaining("Teto de gasto") }),
    }));
    expect(db.platformOutreachTarget.findFirst).not.toHaveBeenCalled();
    expect(whatsapp.openConversationWith).not.toHaveBeenCalled();
  });

  it("abaixo do teto continua enviando", async () => {
    const { service, db, campaign } = fixture({ status: "ENVIANDO", dailyLimit: 200, spendLimit: 10, spentAmount: 9.5 });
    await service.avancarCampanha(campaign, new Date());
    expect(db.platformOutreachTarget.findFirst).toHaveBeenCalled();
  });

  it("não retoma com o teto já alcançado", async () => {
    const { service } = fixture({ status: "PAUSADA", spendLimit: 5, spentAmount: 5.2 });
    await expect(service.iniciar("c1")).rejects.toThrow(/Aumente o teto/);
  });

  it("teto aceita centavos, recusa valor inválido e pode ser removido", async () => {
    const { service, db } = fixture({ status: "ENVIANDO" });
    await service.definirTetoDeGasto("c1", 150.555);
    expect(db.platformOutreachCampaign.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { spendLimit: 150.56 } }));
    await expect(service.definirTetoDeGasto("c1", 0.5)).rejects.toThrow(/entre R\$ 1,00/);
    await expect(service.definirTetoDeGasto("c1", "abc")).rejects.toThrow(/entre R\$ 1,00/);
    const resumo = await service.definirTetoDeGasto("c1", null);
    expect(resumo.spendLimit).toBeNull();
  });

  it("sem modelo aprovado a fila espera intacta", async () => {
    const { service, db, whatsapp } = fixture();
    whatsapp.outreachChannelStatus.mockResolvedValue({ channelId: "ch1", connected: true, template: { approved: false } });
    await service.girar(new Date());
    expect(db.platformOutreachCampaign.findMany).not.toHaveBeenCalled();
  });
});
