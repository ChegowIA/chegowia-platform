import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AIAgentRole, AIChannel, AIMessageRole, DeliveryStatus, PromotionStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { AI_PROVIDER, AIChatMessage, AIProvider } from "./providers/ai-provider.interface";
import { PromptBuilderService } from "./prompt-builder.service";
import { ToolsService } from "./tools/tools.service";
import { ATENDIMENTO_TOOLS, ONBOARDING_TOOLS, OPERATIONAL_TOOLS } from "./tools/tool-definitions";
import { PublicDiscoveryDto } from "./dto/public-discovery.dto";

const SENSITIVE_TOOLS = new Set(["createPromotionDraft"]);
const MAX_TOOL_ITERATIONS = 3;
const MOTOBOY_ASSISTANT_TITLE = "Assistente do motoboy";

@Injectable()
export class AiService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly promptBuilder: PromptBuilderService,
    private readonly toolsService: ToolsService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  private toolsForRole(role: AIAgentRole) {
    switch (role) {
      case AIAgentRole.OPERACIONAL:
        return OPERATIONAL_TOOLS;
      case AIAgentRole.ONBOARDING:
        return ONBOARDING_TOOLS;
      case AIAgentRole.ATENDIMENTO:
      default:
        return ATENDIMENTO_TOOLS;
    }
  }

  private executeTool(name: string, companyId: string, args: any): Promise<unknown> {
    switch (name) {
      case "getTodayOrders":
        return this.toolsService.getTodayOrders(companyId);
      case "getDelayedOrders":
        return this.toolsService.getDelayedOrders(companyId, args?.thresholdMinutes);
      case "getTopProducts":
        return this.toolsService.getTopProducts(companyId, args?.period ?? "today");
      case "getPendingDeliveries":
        return this.toolsService.getPendingDeliveries(companyId);
      case "getInactiveCustomers":
        return this.toolsService.getInactiveCustomers(companyId, args?.days);
      case "createPromotionDraft":
        return this.toolsService.createPromotionDraft(companyId, args);
      case "generateProductDescription":
        return this.toolsService.generateProductDescription(args);
      case "searchCatalog":
        return this.toolsService.searchCatalog(companyId, args);
      case "getStoreInfo":
        return this.toolsService.getStoreInfo(companyId);
      default:
        return Promise.resolve({ error: `Ferramenta desconhecida: ${name}` });
    }
  }

  async startConversation(params: { companyId: string; agentRole: AIAgentRole; channel: AIChannel; userId?: string; title?: string }) {
    return this.db().aIConversation.create({ data: params });
  }

  async searchPublicCatalog(dto: PublicDiscoveryDto) {
    return this.toolsService.searchPublicCatalog(dto);
  }

  async listConversations(channel?: AIChannel) {
    return this.db().aIConversation.findMany({
      where: channel ? { channel } : {},
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
  }

  async getConversation(id: string) {
    const conversation = await this.db().aIConversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw new NotFoundException("Conversa não encontrada.");
    return conversation;
  }

  /** Ponto único de entrada de mensagens — usado tanto pelo painel (OPERACIONAL/ONBOARDING) quanto pela loja pública (ATENDIMENTO). */
  async sendMessage(conversationId: string, content: string) {
    const conversation = await this.getConversation(conversationId);
    const company = await this.db().company.findUnique({
      where: { id: conversation.companyId },
      include: { settings: true },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada.");

    await this.db().aIMessage.create({
      data: { conversationId, role: AIMessageRole.USER, content },
    });

    const history = await this.db().aIMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    const systemPrompt = this.promptBuilder.build({
      role: conversation.agentRole,
      companyName: company.name,
      companyKnowledgeBase: company.settings?.aiKnowledgeBase,
    });

    const messages: AIChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m: any) => ({
        role: m.role.toLowerCase() as AIChatMessage["role"],
        content: m.content,
        name: m.toolName ?? undefined,
      })),
    ];

    const tools = this.toolsForRole(conversation.agentRole);
    let result = await this.aiProvider.chat(messages, tools);
    let iterations = 0;

    while (result.toolCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      // A mensagem do assistente que pediu as tool calls precisa ser reenviada
      // no histórico — senão a API rejeita as mensagens 'tool' seguintes por não
      // conseguir casar o tool_call_id com nenhum tool_call conhecido.
      messages.push({ role: "assistant", content: result.content ?? "", toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const requiresConfirmation = SENSITIVE_TOOLS.has(call.name);
        const toolResult = await this.executeTool(call.name, conversation.companyId, call.arguments);

        await this.db().aIActionLog.create({
          data: {
            conversationId,
            companyId: conversation.companyId,
            toolName: call.name,
            payload: call.arguments as any,
            requiresConfirmation,
            confirmed: !requiresConfirmation,
            result: toolResult as any,
          },
        });
        await this.db().aIMessage.create({
          data: {
            conversationId,
            role: AIMessageRole.TOOL,
            content: JSON.stringify(toolResult),
            toolName: call.name,
            toolPayload: call.arguments as any,
          },
        });
        messages.push({ role: "tool", name: call.name, content: JSON.stringify(toolResult), toolCallId: call.id });
      }
      result = await this.aiProvider.chat(messages, tools);
      iterations += 1;
    }

    const assistantMessage = await this.db().aIMessage.create({
      data: { conversationId, role: AIMessageRole.ASSISTANT, content: result.content ?? "" },
    });
    await this.db().aIConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    return { conversationId, message: assistantMessage };
  }

  // -------------------------------------------------------------------------
  // Atendimento ao cliente final (loja pública) — CLIENTE só acessa a própria
  // conversa. Como o CLIENTE não tem companyId de tenant fixo, o contexto de tenant
  // fica em bypass para essas requisições (ver TenantInterceptor), então a
  // verificação de propriedade abaixo é a única barreira contra acessar a conversa
  // de outro cliente — por isso ela é obrigatória em todo caminho público.
  // -------------------------------------------------------------------------

  async startOrGetCustomerConversation(companySlug: string, userId: string) {
    const company = await this.db().company.findFirst({ where: { slug: companySlug, isActive: true } });
    if (!company) throw new NotFoundException("Loja não encontrada.");

    const existing = await this.db().aIConversation.findFirst({
      where: { companyId: company.id, userId, channel: AIChannel.CLIENTE },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;

    return this.startConversation({
      companyId: company.id,
      agentRole: AIAgentRole.ATENDIMENTO,
      channel: AIChannel.CLIENTE,
      userId,
    });
  }

  async getConversationForCustomer(id: string, userId: string) {
    const conversation = await this.getConversation(id);
    this.assertCustomerOwnership(conversation, userId);
    return conversation;
  }

  async sendMessageAsCustomer(id: string, userId: string, content: string) {
    const conversation = await this.getConversation(id);
    this.assertCustomerOwnership(conversation, userId);
    return this.sendMessage(id, content);
  }

  private assertCustomerOwnership(conversation: { channel: AIChannel; userId: string | null }, userId: string) {
    if (conversation.channel !== AIChannel.CLIENTE || conversation.userId !== userId) {
      throw new ForbiddenException("Você não tem acesso a esta conversa.");
    }
  }

  // -------------------------------------------------------------------------
  // Assistente do motoboy — conversa interna, mas restrita às entregas atribuídas
  // ao próprio motoboy. Não usa ferramentas administrativas.
  // -------------------------------------------------------------------------

  async startOrGetMotoboyConversation(companyId: string, userId: string) {
    const existing = await this.db().aIConversation.findFirst({
      where: { companyId, userId, channel: AIChannel.INTERNO, title: MOTOBOY_ASSISTANT_TITLE },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;

    return this.startConversation({
      companyId,
      agentRole: AIAgentRole.OPERACIONAL,
      channel: AIChannel.INTERNO,
      userId,
      title: MOTOBOY_ASSISTANT_TITLE,
    });
  }

  async getConversationForMotoboy(id: string, userId: string) {
    const conversation = await this.getConversation(id);
    this.assertMotoboyOwnership(conversation, userId);
    return conversation;
  }

  async sendMessageAsMotoboy(id: string, userId: string, content: string) {
    const conversation = await this.getConversation(id);
    this.assertMotoboyOwnership(conversation, userId);

    await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.USER, content },
    });

    const [history, company, deliveries] = await Promise.all([
      this.db().aIMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } }),
      this.db().company.findUnique({ where: { id: conversation.companyId }, include: { settings: true } }),
      this.motoboyDeliveries(userId),
    ]);

    if (!company) throw new NotFoundException("Empresa não encontrada.");

    const messages: AIChatMessage[] = [
      { role: "system", content: this.buildMotoboySystemPrompt(company.name, company.settings?.aiKnowledgeBase, deliveries) },
      ...history.map((m: any) => ({
        role: m.role.toLowerCase() as AIChatMessage["role"],
        content: m.content,
        name: m.toolName ?? undefined,
      })),
    ];

    let contentToSave: string;
    try {
      const result = await this.aiProvider.chat(messages);
      contentToSave = result.content?.trim() || this.fallbackMotoboyAnswer(content, deliveries);
    } catch {
      contentToSave = this.fallbackMotoboyAnswer(content, deliveries);
    }

    const assistantMessage = await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.ASSISTANT, content: contentToSave },
    });
    await this.db().aIConversation.update({ where: { id }, data: { updatedAt: new Date() } });

    return { conversationId: id, message: assistantMessage };
  }

  private assertMotoboyOwnership(conversation: { channel: AIChannel; userId: string | null; title?: string | null }, userId: string) {
    if (conversation.channel !== AIChannel.INTERNO || conversation.userId !== userId || conversation.title !== MOTOBOY_ASSISTANT_TITLE) {
      throw new ForbiddenException("Você não tem acesso a esta conversa.");
    }
  }

  private motoboyDeliveries(motoboyId: string) {
    return this.db().delivery.findMany({
      where: { motoboyId },
      include: {
        order: {
          include: {
            customer: { select: { id: true, name: true } },
          },
        },
        motoboy: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  private buildMotoboySystemPrompt(companyName: string, companyKnowledgeBase: string | null | undefined, deliveries: any[]) {
    return [
      `Você é o assistente de entregas da ChegowIA para um MOTOBOY da empresa "${companyName}".`,
      "Responda em português do Brasil, em tom direto, conversando de igual para igual.",
      "Escopo absoluto: responda apenas sobre entregas atribuídas ao motoboy, rota, endereço, cliente, status, retirada, problema, localização, próximos passos e organização da rota.",
      "Se o motoboy perguntar qualquer coisa fora de entregas, recuse brevemente e puxe de volta para entregas. Não responda assunto geral, financeiro, cardápio, administração, funcionários ou dados de outros clientes.",
      "Use somente o contexto abaixo. Se faltar dado, diga exatamente o que falta.",
      "Não invente distância, tempo de rota, telefone, pagamento ou posição em tempo real. Se precisar de navegação, oriente a usar o botão de rota do app.",
      "Quando útil, responda como chat curto. Não faça texto longo sem necessidade.",
      "# Treinamento da empresa",
      companyKnowledgeBase?.trim() || "(nenhum treinamento cadastrado)",
      "# Entregas atribuídas ao motoboy",
      this.formatMotoboyDeliveries(deliveries),
    ].join("\n\n");
  }

  private formatMotoboyDeliveries(deliveries: any[]) {
    if (deliveries.length === 0) return "Nenhuma entrega atribuída no momento.";

    return deliveries
      .map((delivery, index) => {
        const order = delivery.order;
        return [
          `${index + 1}. Entrega ${delivery.id}`,
          `Pedido: ${order.id}`,
          `Cliente: ${order.customer?.name ?? "não informado"}`,
          `Status da entrega: ${delivery.status}`,
          `Endereço: ${order.deliveryStreet}, ${order.deliveryNumber}${order.deliveryComplement ? ` - ${order.deliveryComplement}` : ""} - ${order.deliveryNeighborhood} - ${order.deliveryCity}/${order.deliveryState}`,
          order.deliveryReference ? `Referência: ${order.deliveryReference}` : null,
          `Status do pedido: ${order.status}`,
          `Atualizada em: ${delivery.updatedAt?.toISOString?.() ?? delivery.updatedAt}`,
          delivery.motoboyLocationUpdatedAt
            ? `Última localização compartilhada: ${delivery.motoboyLatitude}, ${delivery.motoboyLongitude} em ${delivery.motoboyLocationUpdatedAt.toISOString?.() ?? delivery.motoboyLocationUpdatedAt}`
            : "Localização compartilhada: ainda não enviada",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }

  private fallbackMotoboyAnswer(question: string, deliveries: any[]) {
    const normalized = question
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const active = deliveries.filter((delivery) => delivery.status !== DeliveryStatus.ENTREGUE && delivery.status !== DeliveryStatus.PROBLEMA);
    const next = active[0] ?? deliveries[0];

    if (!deliveries.length) return "Você não tem entregas atribuídas no momento.";

    const greeting = /\b(oi|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí)\b/.test(normalized);
    if (greeting) {
      return "Estou por aqui. Me pergunta sobre próxima entrega, endereço, status, rota ou algum problema na entrega que eu te ajudo.";
    }

    const deliveryScope = [
      "entrega",
      "pedido",
      "rota",
      "endereco",
      "endereço",
      "cliente",
      "status",
      "problema",
      "retirada",
      "retirar",
      "caminho",
      "proxima",
      "próxima",
      "pendente",
      "localizacao",
      "localização",
      "mapa",
      "bairro",
      "rua",
      "destino",
      "onde",
      "resumo",
    ].some((keyword) => normalized.includes(keyword));

    if (normalized.includes("status")) {
      return deliveries
        .map((delivery: any, index: number) => `${index + 1}. ${delivery.order.customer?.name ?? "Cliente"} - ${delivery.status} - ${delivery.order.deliveryNeighborhood}`)
        .join("\n");
    }

    if (!deliveryScope || normalized.includes("cardapio") || normalized.includes("financeiro")) {
      return "Esse chat é só para entregas. Posso te ajudar com próxima rota, endereço, status ou entregas pendentes.";
    }

    if (!next) return "Não encontrei uma próxima entrega para você agora.";

    const address = `${next.order.deliveryStreet}, ${next.order.deliveryNumber} - ${next.order.deliveryNeighborhood} - ${next.order.deliveryCity}/${next.order.deliveryState}`;
    return `Sua próxima referência de entrega é:\nCliente: ${next.order.customer?.name ?? "Cliente"}\nEndereço: ${address}\nStatus: ${next.status}\n\nUse o botão de rota do app para abrir a navegação.`;
  }

  /** Só o ADMIN confirma — é o que efetivamente ativa uma ação sensível (ex.: promoção sugerida pela IA). */
  async confirmAction(actionLogId: string, confirmedByUserId: string) {
    const log = await this.db().aIActionLog.findUnique({ where: { id: actionLogId } });
    if (!log) throw new NotFoundException("Ação não encontrada.");
    if (!log.requiresConfirmation) throw new BadRequestException("Esta ação não exige confirmação.");
    if (log.confirmed) throw new BadRequestException("Ação já confirmada.");

    if (log.toolName === "createPromotionDraft") {
      const promotionId = (log.result as any)?.id;
      if (!promotionId) throw new ForbiddenException("Rascunho de promoção não encontrado no log.");
      await this.db().promotion.update({ where: { id: promotionId }, data: { status: PromotionStatus.ATIVA } });
    }

    return this.db().aIActionLog.update({
      where: { id: actionLogId },
      data: { confirmed: true, confirmedByUserId, confirmedAt: new Date() },
    });
  }
}
