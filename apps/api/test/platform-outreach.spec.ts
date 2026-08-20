import { BadRequestException } from "@nestjs/common";
import { PlatformOutreachService, dentroDoHorarioComercial } from "../src/messaging/platform-outreach.service";

/**
 * O que estes testes protegem não é a mensagem, é o número.
 *
 * O WhatsApp institucional é o mesmo que atende quem já é cliente. Se ele for
 * restringido por denúncia de spam, o suporte cai junto — então cada trava aqui
 * (ritmo, horário, limite diário, pausa automática, lista de não contatar) existe
 * porque removê-la custaria o canal inteiro, não só um disparo.
 */

type Alvo = {
  id: string;
  phone: string;
  name?: string | null;
  city?: string | null;
  status: string;
  attempts?: number;
  sentAt?: Date | null;
  createdAt?: Date;
  errorMessage?: string | null;
  discardReason?: string | null;
  conversationId?: string | null;
};

function construir(opcoes: {
  campanha?: Record<string, unknown>;
  alvos?: Alvo[];
  canal?: Record<string, unknown> | null;
  bloqueios?: { phone: string }[];
  conversas?: { customerPhone: string }[];
  alvosAnteriores?: { phone: string }[];
  empresas?: { phone: string | null; whatsapp: string | null }[];
  abrirConversa?: jest.Mock;
} = {}) {
  const alvos: Alvo[] = (opcoes.alvos ?? []).map((alvo) => ({ createdAt: new Date(), attempts: 0, ...alvo }));
  const campanha = {
    id: "camp-1",
    channelId: "canal-1",
    name: "Restaurantes de Goiânia",
    status: "ENVIANDO",
    fallbackName: "tudo bem",
    dailyLimit: 200,
    minIntervalSeconds: 15,
    maxIntervalSeconds: 30,
    respectBusinessHours: false,
    nextSendAt: null,
    totalTargets: alvos.length,
    sentCount: 0,
    repliedCount: 0,
    failedCount: 0,
    startedAt: null,
    ...opcoes.campanha,
  };
  const canal = opcoes.canal === undefined
    ? { id: "canal-1", outreachTemplateId: "modelo-1", outreachTemplateName: null }
    : opcoes.canal;

  const prisma: any = {
    platformOutreachCampaign: {
      findMany: jest.fn().mockResolvedValue([{ ...campanha, channel: canal }]),
      findUnique: jest.fn().mockResolvedValue(campanha),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...campanha, ...data, id: "camp-nova" })),
      update: jest.fn().mockImplementation(({ data }: any) => {
        Object.assign(campanha, resolverIncrementos(campanha, data));
        return Promise.resolve({ ...campanha });
      }),
    },
    platformOutreachTarget: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(alvos.find((alvo) => alvo.status === where.status) ?? null)),
      findMany: jest.fn().mockResolvedValue(opcoes.alvosAnteriores ?? []),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const alvo = alvos.find((item) => item.id === where.id)!;
        Object.assign(alvo, resolverIncrementos(alvo, data));
        return Promise.resolve({ ...alvo });
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    platformOutreachBlock: {
      findMany: jest.fn().mockResolvedValue(opcoes.bloqueios ?? []),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ phone: "5562999998888" }),
      delete: jest.fn().mockResolvedValue({}),
    },
    platformWhatsAppChannel: {
      findFirst: jest.fn().mockResolvedValue(canal),
      findUnique: jest.fn().mockResolvedValue(canal),
    },
    platformWhatsAppConversation: {
      findMany: jest.fn().mockResolvedValue(opcoes.conversas ?? []),
    },
    company: { findMany: jest.fn().mockResolvedValue(opcoes.empresas ?? []) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: "u-1", name: "Thiago" }) },
  };

  const platform = {
    openConversationWith: opcoes.abrirConversa
      ?? jest.fn().mockResolvedValue({ conversation: { id: "conv-1" }, via: "modelo" }),
  };
  const service: any = Object.create(PlatformOutreachService.prototype);
  service.prisma = prisma;
  service.platform = platform;
  service.realtime = { emitToSuperAdmins: jest.fn() };
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  service.processando = false;
  return { service, prisma, platform, campanha, alvos };
}

/** O mock precisa entender `{ increment: n }` como o Prisma entende. */
function resolverIncrementos(atual: any, data: any) {
  const resultado: any = {};
  for (const [chave, valor] of Object.entries(data ?? {})) {
    resultado[chave] = valor && typeof valor === "object" && "increment" in (valor as any)
      ? (atual[chave] ?? 0) + (valor as any).increment
      : valor;
  }
  return resultado;
}

describe("criação do disparo", () => {
  it("lê a lista colada e cria um alvo por número", async () => {
    const { service, prisma } = construir();
    jest.spyOn(service, "detalharCampanha").mockResolvedValue({ id: "camp-nova" });

    await service.criarCampanha("u-1", {
      name: "Feira de food service",
      contacts: "Pizzaria do Zé - Goiânia - (62) 99999-8888\nBar do João | 62 98888-7777",
    });

    const criados = prisma.platformOutreachCampaign.create.mock.calls[0][0].data.targets.create;
    expect(criados).toHaveLength(2);
    expect(criados[0]).toMatchObject({ phone: "5562999998888", name: "Pizzaria do Zé", city: "Goiânia" });
  });

  it("descarta quem pediu para não receber, quem já conversou e quem já é cliente", async () => {
    const { service, prisma } = construir({
      bloqueios: [{ phone: "5562911111111" }],
      conversas: [{ customerPhone: "5562922222222" }],
      alvosAnteriores: [{ phone: "5562933333333" }],
      empresas: [{ phone: "(62) 94444-4444", whatsapp: null }],
    });
    jest.spyOn(service, "detalharCampanha").mockResolvedValue({ id: "camp-nova" });

    await service.criarCampanha("u-1", {
      name: "Lista mista",
      contacts: [
        "62 91111-1111",
        "62 92222-2222",
        "62 93333-3333",
        "62 94444-4444",
        "62 95555-5555",
      ].join("\n"),
    });

    const dados = prisma.platformOutreachCampaign.create.mock.calls[0][0].data;
    // Só o último número é novo; os quatro primeiros ficam registrados como
    // descartados para o relatório fechar com o que foi colado.
    expect(dados.totalTargets).toBe(1);
    const descartados = dados.targets.create.filter((alvo: any) => alvo.status === "DESCARTADO");
    expect(descartados.map((alvo: any) => alvo.discardReason)).toEqual([
      "pediu para não receber",
      "já existe conversa com este número",
      "já entrou em outro disparo",
      "número de uma empresa que já é cliente",
    ]);
  });

  it("lista inteira já abordada não vira disparo vazio", async () => {
    const { service } = construir({ conversas: [{ customerPhone: "5562999998888" }] });

    await expect(service.criarCampanha("u-1", { name: "Repetida", contacts: "62 99999-8888" }))
      .rejects.toThrow(/já foram abordados/);
  });

  it("lista sem telefone válido é recusada com instrução", async () => {
    const { service } = construir();

    await expect(service.criarCampanha("u-1", { name: "Vazia", contacts: "sem número aqui" }))
      .rejects.toThrow(/DDD e número/);
  });

  it("intervalo máximo menor que o mínimo é corrigido em vez de virar sorteio inválido", async () => {
    const { service, prisma } = construir();
    jest.spyOn(service, "detalharCampanha").mockResolvedValue({ id: "camp-nova" });

    await service.criarCampanha("u-1", {
      name: "Ritmo torto",
      contacts: "62 99999-8888",
      minIntervalSeconds: 60,
      maxIntervalSeconds: 10,
    });

    const dados = prisma.platformOutreachCampaign.create.mock.calls[0][0].data;
    expect(dados.minIntervalSeconds).toBe(60);
    expect(dados.maxIntervalSeconds).toBe(60);
  });
});

describe("começar o disparo", () => {
  it("sem modelo aprovado o disparo não começa", async () => {
    // Sem modelo, todo envio seria recusado pela Meta — e cada recusa conta
    // contra o número.
    const { service } = construir({ canal: { id: "canal-1", outreachTemplateId: null, outreachTemplateName: null } });

    await expect(service.iniciar("camp-1")).rejects.toThrow(BadRequestException);
    await expect(service.iniciar("camp-1")).rejects.toThrow(/modelo aprovado/);
  });

  it("com modelo cadastrado libera o primeiro envio", async () => {
    const { service, prisma } = construir();

    await service.iniciar("camp-1");

    expect(prisma.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ENVIANDO", pausedReason: null }),
    }));
  });

  it("disparo cancelado não é retomado", async () => {
    const { service } = construir({ campanha: { status: "CANCELADA" } });

    await expect(service.iniciar("camp-1")).rejects.toThrow(/já foi encerrado/);
  });
});

describe("ritmo do disparo", () => {
  it("manda um por giro e agenda o próximo dentro do intervalo", async () => {
    const agora = new Date("2026-08-20T13:00:00Z");
    const { service, prisma, platform } = construir({
      alvos: [
        { id: "a-1", phone: "5562999998888", status: "PENDENTE" },
        { id: "a-2", phone: "5562988887777", status: "PENDENTE" },
      ],
    });

    await service.processarDisparos(agora);

    expect(platform.openConversationWith).toHaveBeenCalledTimes(1);
    const agendamento = prisma.platformOutreachCampaign.update.mock.calls.at(-1)![0].data.nextSendAt as Date;
    const esperaSegundos = (agendamento.getTime() - agora.getTime()) / 1000;
    expect(esperaSegundos).toBeGreaterThanOrEqual(15);
    expect(esperaSegundos).toBeLessThanOrEqual(30);
  });

  it("não antecipa envio agendado para depois", async () => {
    const agora = new Date("2026-08-20T13:00:00Z");
    const { service, platform } = construir({
      campanha: { nextSendAt: new Date(agora.getTime() + 20_000) },
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE" }],
    });

    await service.processarDisparos(agora);

    expect(platform.openConversationWith).not.toHaveBeenCalled();
  });

  it("limite diário alcançado adia para o dia seguinte", async () => {
    const agora = new Date("2026-08-20T13:00:00Z");
    const { service, prisma, platform } = construir({
      campanha: { dailyLimit: 50 },
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE" }],
    });
    prisma.platformOutreachTarget.count.mockResolvedValue(50);

    await service.processarDisparos(agora);

    expect(platform.openConversationWith).not.toHaveBeenCalled();
    // Sem o reagendamento o worker giraria a cada 10 segundos batendo no limite.
    const agendamento = prisma.platformOutreachCampaign.update.mock.calls.at(-1)![0].data.nextSendAt as Date;
    expect(agendamento.getTime()).toBeGreaterThan(agora.getTime());
  });

  it("fila vazia conclui o disparo", async () => {
    const { service, prisma } = construir({ alvos: [], campanha: { sentCount: 12, totalTargets: 12 } });

    await service.processarDisparos(new Date("2026-08-20T13:00:00Z"));

    expect(prisma.platformOutreachCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CONCLUIDA" }),
    }));
  });

  it("fora do horário comercial nada sai", async () => {
    const { service, platform } = construir({
      campanha: { respectBusinessHours: true },
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE" }],
    });

    // 06:00 em Brasília: mensagem de venda nesse horário é denúncia pedida.
    await service.processarDisparos(new Date("2026-08-20T09:00:00Z"));

    expect(platform.openConversationWith).not.toHaveBeenCalled();
  });

  it("horário comercial é contado no fuso de Brasília, não no do servidor", () => {
    // 12:00 UTC = 09:00 em Brasília (dentro); 02:00 UTC = 23:00 do dia anterior.
    expect(dentroDoHorarioComercial(new Date("2026-08-20T12:00:00Z"))).toBe(true);
    expect(dentroDoHorarioComercial(new Date("2026-08-20T02:00:00Z"))).toBe(false);
    // Domingo fica de fora inteiro.
    expect(dentroDoHorarioComercial(new Date("2026-08-23T15:00:00Z"))).toBe(false);
  });
});

describe("falha no envio", () => {
  it("primeira falha não desiste do contato", async () => {
    const { service, alvos } = construir({
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE" }],
      abrirConversa: jest.fn().mockRejectedValue(new Error("Gupshup fora do ar")),
    });

    await service.processarDisparos(new Date("2026-08-20T13:00:00Z"));

    expect(alvos[0].status).toBe("PENDENTE");
    expect(alvos[0].attempts).toBe(1);
    expect(alvos[0].errorMessage).toContain("Gupshup fora do ar");
  });

  it("segunda falha marca o contato como falho", async () => {
    const { service, alvos, campanha } = construir({
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE", attempts: 1 }],
      abrirConversa: jest.fn().mockRejectedValue(new Error("modelo não aprovado")),
    });

    await service.processarDisparos(new Date("2026-08-20T13:00:00Z"));

    expect(alvos[0].status).toBe("FALHOU");
    expect(campanha.failedCount).toBe(1);
  });

  it("nada funcionando pausa o disparo sozinho", async () => {
    // O caso real é modelo recusado pela Meta: sem a pausa, 300 números viram
    // 300 recusas registradas contra o número.
    const { service, prisma } = construir({
      campanha: { sentCount: 0, failedCount: 4 },
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE", attempts: 1 }],
      abrirConversa: jest.fn().mockRejectedValue(new Error("Template não encontrado")),
    });

    await service.processarDisparos(new Date("2026-08-20T13:00:00Z"));

    const pausa = prisma.platformOutreachCampaign.update.mock.calls
      .map((chamada: any[]) => chamada[0].data)
      .find((data: any) => data.status === "PAUSADA");
    expect(pausa).toBeDefined();
    expect(pausa.pausedReason).toContain("Template não encontrado");
  });

  it("um disparo com problema não impede os outros", async () => {
    const { service, prisma } = construir({
      alvos: [{ id: "a-1", phone: "5562999998888", status: "PENDENTE" }],
    });
    prisma.platformOutreachCampaign.findMany.mockResolvedValue([
      { id: "camp-quebrada", channelId: "canal-1", name: "Quebrada", respectBusinessHours: false, dailyLimit: 10, minIntervalSeconds: 15, maxIntervalSeconds: 30, sentCount: 0, failedCount: 0, totalTargets: 1 },
    ]);
    prisma.platformOutreachTarget.count.mockRejectedValue(new Error("banco indisponível"));

    await expect(service.processarDisparos(new Date("2026-08-20T13:00:00Z"))).resolves.toBeUndefined();
  });
});

describe("cancelamento", () => {
  it("cancelar descarta o que ainda não saiu, sem apagar o histórico", async () => {
    const { service, prisma } = construir();
    const tx = {
      platformOutreachTarget: { updateMany: jest.fn().mockResolvedValue({ count: 7 }) },
      platformOutreachCampaign: { update: jest.fn().mockResolvedValue({ id: "camp-1", status: "CANCELADA", totalTargets: 10, sentCount: 3, failedCount: 0, repliedCount: 1 }) },
    };
    prisma.$transaction = jest.fn().mockImplementation((fn: any) => fn(tx));

    await service.cancelar("camp-1");

    expect(tx.platformOutreachTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { campaignId: "camp-1", status: "PENDENTE" },
      data: { status: "DESCARTADO", discardReason: "disparo cancelado" },
    }));
  });
});
