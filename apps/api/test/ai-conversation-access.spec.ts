import { AIAgentRole, AIChannel } from "@prisma/client";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AiService } from "../src/ai/ai.service";

/**
 * Títulos dos assistentes privados de papel. Declarados aqui, e não inline em
 * cada expectativa, porque a lista cresce a cada papel novo — quando a cozinha
 * ganhou assistente, três expectativas quebraram por estarem fixas nos dois
 * títulos anteriores, sem que nada de errado tivesse acontecido.
 */
const ASSISTENTES_PRIVADOS = [
  "Assistente do motoboy",
  "Assistente do garçom",
  "Assistente da cozinha",
];

describe("Isolamento das conversas de IA", () => {
  function createService() {
    const prisma = {
      aIConversation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    return {
      prisma,
      service: new AiService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never),
    };
  }

  it("não lista nenhum assistente privado de papel no painel interno", async () => {
    const { prisma, service } = createService();

    await service.listInternalConversations("empresa-1");

    expect(prisma.aIConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companyId: "empresa-1",
        channel: AIChannel.INTERNO,
        OR: [
          { title: null },
          { title: { notIn: ASSISTENTES_PRIVADOS } },
        ],
      }),
    }));
  });

  it("mantém os assistentes privados fora até da listagem genérica", async () => {
    const { prisma, service } = createService();

    await service.listConversations();

    expect(prisma.aIConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { channel: AIChannel.INTERNO, title: { notIn: ASSISTENTES_PRIVADOS } },
        ]),
      }),
    }));
  });

  it("bloqueia acesso direto do painel à conversa do motoboy", async () => {
    const { prisma, service } = createService();

    await expect(service.getInternalConversation("conversa-motoboy", "empresa-1"))
      .rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.aIConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "conversa-motoboy",
        companyId: "empresa-1",
        channel: AIChannel.INTERNO,
        OR: [
          { title: null },
          { title: { notIn: ASSISTENTES_PRIVADOS } },
        ],
      }),
    }));
  });

  it("não permite criar um agente de atendimento como conversa interna", async () => {
    const { service } = createService();

    await expect(service.startInternalConversation({
      companyId: "empresa-1",
      userId: "usuario-1",
      agentRole: AIAgentRole.ATENDIMENTO,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("reserva o título do assistente do garçom para a rota privada", async () => {
    const { service } = createService();

    await expect(service.startInternalConversation({
      companyId: "empresa-1",
      userId: "usuario-1",
      agentRole: AIAgentRole.OPERACIONAL,
      title: "Assistente do garçom",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("não permite que outro garçom leia a conversa privada", async () => {
    const { prisma, service } = createService();
    prisma.aIConversation.findUnique.mockResolvedValue({
      id: "conversa-garcom",
      channel: AIChannel.INTERNO,
      userId: "garcom-1",
      title: "Assistente do garçom",
      messages: [],
    });

    await expect(service.getConversationForWaiter("conversa-garcom", "garcom-2"))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
