import { buildPlatformWhatsAppService } from "./support/messaging-services";

/**
 * Sticker e reação não carregam pergunta. Responder a eles com texto de vendas é
 * o que faz o assistente parecer robô: ninguém que mandou um emoji grande espera
 * receber um parágrafo de volta. Áudio, imagem e documento continuam acionando o
 * assistente, que ao menos avisa que não consegue abrir o arquivo.
 */
describe("conteúdo sem pergunta no canal institucional", () => {
  const channel = {
    id: "canal-1",
    status: "ATIVO",
    automationEnabled: true,
    provider: "GUPSHUP",
    gupshupAppName: "chegowiainstitucional",
    config: { number: "556231425344" },
  };

  function build() {
    const prisma = {
      platformWhatsAppChannel: { findUnique: jest.fn().mockResolvedValue(channel), update: jest.fn() },
      platformWhatsAppConversation: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: "conversa-1", mode: "VIRTUAL", customerPhone: "5562988887777" }),
      },
      platformWhatsAppMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "msg-1" }),
      },
    };
    const instance = buildPlatformWhatsAppService({
      prisma,
      realtime: { emitToSuperAdmins: jest.fn() },
    });
    const responder = jest.fn().mockResolvedValue(undefined);
    (instance as never as Record<string, unknown>).answerWithSalesAssistant = responder;
    return { instance, responder, prisma };
  }

  async function receive(type: string, extra: Record<string, unknown> = {}) {
    const { instance, responder, prisma } = build();
    await (instance as never as Record<string, Function>).processIncomingMessage(
      channel,
      [{ profile: { name: "Thiago" }, wa_id: "5562988887777" }],
      { from: "5562988887777", id: `msg-${type}`, type, ...extra },
      {},
    );
    return { responder, prisma };
  }

  it.each(["sticker", "reaction"])("não responde a %s", async (type) => {
    const { responder, prisma } = await receive(type);

    expect(responder).not.toHaveBeenCalled();
    // A mensagem continua registrada: some da resposta, não da conversa.
    expect(prisma.platformWhatsAppMessage.create).toHaveBeenCalled();
  });

  it.each(["audio", "image", "document"])("ainda responde a %s, para avisar que não abre o arquivo", async (type) => {
    const { responder } = await receive(type);
    expect(responder).toHaveBeenCalled();
  });

  it("responde a texto normalmente", async () => {
    const { responder } = await receive("text", { text: { body: "Quanto custa?" } });
    expect(responder).toHaveBeenCalled();
  });

  it("não responde a texto vazio", async () => {
    const { responder } = await receive("text", { text: { body: "   " } });
    expect(responder).not.toHaveBeenCalled();
  });
});
