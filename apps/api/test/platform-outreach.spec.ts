import { PlatformOutreachService } from "../src/messaging/platform-outreach.service";
import { RemetenteDesconectadoError } from "../src/messaging/baileys-outreach-sender.service";

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
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  db.$transaction = jest.fn().mockImplementation((fn: any) => fn(db));
  const sender = {
    status: jest.fn().mockResolvedValue({ configured: true }),
    sendText: jest.fn().mockResolvedValue({ messageId: "wamid-1" }),
  };
  const service: any = Object.create(PlatformOutreachService.prototype);
  Object.assign(service, {
    prisma: db, sender, realtime: { emitToSuperAdmins: jest.fn() },
    logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }, processando: false,
  });
  return { service, db, sender, campaign };
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
    const { service, db, sender } = fixture();
    db.platformOutreachTarget.count.mockResolvedValue(1);
    await expect(service.iniciar("c1")).rejects.toThrow(/ainda não estão autorizados/);
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it("exige o número QR conectado antes de iniciar", async () => {
    const { service, sender } = fixture();
    sender.status.mockResolvedValue({ configured: false });
    await expect(service.iniciar("c1")).rejects.toThrow(/Conecte o WhatsApp/);
  });

  it("inicia somente depois de conferir o número e a trava", async () => {
    const { service, db, sender } = fixture();
    await service.iniciar("c1");
    expect(sender.status).toHaveBeenCalled();
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIANDO" }),
    }));
  });

  const target = {
    id: "t1", phone: "5562999998888", status: "PENDENTE", attempts: 0,
    consentStatus: "CONFIRMADO", approvalStatus: "APROVADO", generationStatus: "PRONTO",
    proposal: "organizar pedidos", messageText: "Olá.",
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

  it("pausa sem reenviar quando o resultado do socket é incerto", async () => {
    const { service, db, campaign, sender } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    sender.sendText.mockRejectedValue(new Error("timeout"));
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(db.platformOutreachAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "INCERTA" }),
    }));
    expect(db.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSADA" }),
    }));
    expect(db.platformOutreachSenderState.updateMany).not.toHaveBeenCalled();
  });

  it("não chama WhatsApp se a campanha foi pausada após reservar", async () => {
    const { service, db, campaign, sender } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    db.platformOutreachCampaign.findUnique.mockResolvedValue({ ...campaign, status: "PAUSADA" });
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(sender.sendText).not.toHaveBeenCalled();
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

  it("devolve o lead à fila quando o socket não estava aberto, sem pausar", async () => {
    const { service, db, campaign, sender } = reservation();
    db.platformOutreachTarget.findUnique.mockResolvedValue({ ...target, status: "RESERVADO" });
    db.platformOutreachCampaign.findUnique.mockResolvedValue({ ...campaign, status: "ENVIANDO" });
    sender.sendText.mockRejectedValue(new RemetenteDesconectadoError());
    await service.enviarParaAlvo(campaign, target, "attempt-1");
    expect(db.platformOutreachTarget.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDENTE", attempts: { decrement: 1 } }),
    }));
    expect(db.platformOutreachAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "NAO_ENVIADA" }),
    }));
    expect(db.platformOutreachSenderState.updateMany).toHaveBeenCalled();
    expect(db.platformOutreachCampaign.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSADA" }),
    }));
  });

  it("não reserva lead se o socket deste processo não está aberto", async () => {
    const { service, db, sender } = fixture();
    Object.assign(sender, { isReady: jest.fn().mockReturnValue(false) });
    await service.girar(new Date());
    expect(db.platformOutreachCampaign.findMany).not.toHaveBeenCalled();
  });
});
