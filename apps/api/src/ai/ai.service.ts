import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AIAgentRole,
  AIChannel,
  AIMessageRole,
  DiningOrderStatus,
  DeliveryStatus,
  OrderStatus,
  PromotionStatus,
  TableSessionStatus,
} from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { AI_PROVIDER, AIChatMessage, AIProvider } from "./providers/ai-provider.interface";
import { PromptBuilderService } from "./prompt-builder.service";
import { ToolsService } from "./tools/tools.service";
import { ATENDIMENTO_TOOLS, ONBOARDING_TOOLS, OPERATIONAL_TOOLS } from "./tools/tool-definitions";
import { PublicDiscoveryDto } from "./dto/public-discovery.dto";
import { UsageService } from "../usage/usage.service";
import { SearchIntentService } from "./search/search-intent.service";

const SENSITIVE_TOOLS = new Set(["createPromotionDraft"]);
const MAX_TOOL_ITERATIONS = 3;
const MOTOBOY_ASSISTANT_TITLE = "Assistente do motoboy";
const GARCOM_ASSISTANT_TITLE = "Assistente do garçom";
const COZINHA_ASSISTANT_TITLE = "Assistente da cozinha";
/**
 * Assistentes privados de um papel. Ficam fora da listagem do painel
 * administrativo: são conversas de uma pessoa só, e aparecer no histórico do
 * admin transformaria uma ferramenta de trabalho numa janela de supervisão.
 */
const PRIVATE_ASSISTANT_TITLES = [
  MOTOBOY_ASSISTANT_TITLE,
  GARCOM_ASSISTANT_TITLE,
  COZINHA_ASSISTANT_TITLE,
];
const INTERNAL_AGENT_ROLES = new Set<AIAgentRole>([
  AIAgentRole.OPERACIONAL,
  AIAgentRole.ONBOARDING,
]);

@Injectable()
export class AiService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly promptBuilder: PromptBuilderService,
    private readonly toolsService: ToolsService,
    private readonly usage: UsageService,
    private readonly searchIntent: SearchIntentService,
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
        return this.toolsService.generateProductDescription(companyId, args);
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

  /**
   * Descoberta pública do painel flutuante. Passa pela mesma interpretação da
   * busca do topo para que as duas entradas concordem sobre o que o texto
   * significa — o painel fica com a conversa, a busca fica com a listagem.
   */
  async searchPublicCatalog(dto: PublicDiscoveryDto) {
    const intent = await this.searchIntent.resolve(dto.message);
    const result = await this.toolsService.searchPublicCatalog({ ...dto, terms: intent.terms });
    return { ...result, summary: intent.explanation || result.summary };
  }

  async listConversations(channel?: AIChannel) {
    return this.db().aIConversation.findMany({
      // Mesmo este método genérico não devolve assistentes privados. Hoje o
      // painel usa listInternalConversations(), mas esta barreira evita uma
      // exposição futura caso alguém reutilize a listagem por engano.
      where: {
        ...(channel ? { channel } : {}),
        OR: [
          { channel: { not: AIChannel.INTERNO } },
          { channel: AIChannel.INTERNO, title: null },
          { channel: AIChannel.INTERNO, title: { notIn: PRIVATE_ASSISTANT_TITLES } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
  }

  /**
   * O painel interno não pode listar conversas de clientes nem a conversa privada
   * de funções operacionais. A filtragem explícita impede exposição acidental
   * mesmo que uma rota futura rode fora do escopo automático de tenant.
   */
  async listInternalConversations(companyId: string) {
    return this.db().aIConversation.findMany({
      where: {
        companyId,
        channel: AIChannel.INTERNO,
        OR: [
          { title: null },
          { title: { notIn: PRIVATE_ASSISTANT_TITLES } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
  }

  async startInternalConversation(params: {
    companyId: string;
    userId: string;
    agentRole: AIAgentRole;
    title?: string;
  }) {
    if (!INTERNAL_AGENT_ROLES.has(params.agentRole)) {
      throw new BadRequestException("Este agente não está disponível para conversa interna.");
    }
    if (PRIVATE_ASSISTANT_TITLES.includes(params.title?.trim() ?? "")) {
      throw new BadRequestException("Este título é reservado a um assistente privado de função.");
    }
    return this.startConversation({ ...params, channel: AIChannel.INTERNO });
  }

  async getInternalConversation(id: string, companyId: string) {
    const conversation = await this.db().aIConversation.findFirst({
      where: {
        id,
        companyId,
        channel: AIChannel.INTERNO,
        OR: [
          { title: null },
          { title: { notIn: PRIVATE_ASSISTANT_TITLES } },
        ],
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw new NotFoundException("Conversa não encontrada.");
    return conversation;
  }

  async sendMessageAsInternalUser(id: string, companyId: string, content: string) {
    await this.getInternalConversation(id, companyId);
    return this.sendMessage(id, content);
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
      companyContext: this.companyContext(company),
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
    await this.recordAiUsage(conversation.companyId, result);
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
      await this.recordAiUsage(conversation.companyId, result);
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

  /** Cria o histórico que pertence exclusivamente à conversa vinda do WhatsApp. */
  async startWhatsAppConversation(companyId: string, customerPhone: string) {
    return this.startConversation({
      companyId,
      agentRole: AIAgentRole.ATENDIMENTO,
      channel: AIChannel.WHATSAPP,
      title: `WhatsApp ${customerPhone}`,
    });
  }

  private async recordAiUsage(companyId: string, result: Awaited<ReturnType<AIProvider["chat"]>>) {
    if (!result.usage) return;
    await this.usage.recordAiUsage({
      companyId,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      uncachedInputTokens: result.usage.uncachedInputTokens,
      outputTokens: result.usage.outputTokens,
      requestId: result.requestId,
    });
  }

  private companyContext(company: any) {
    const paymentMethods = Array.isArray(company.settings?.paymentMethodsEnabled)
      ? company.settings.paymentMethodsEnabled.join(", ")
      : "não informado";
    const openingHours = company.settings?.openingHours
      ? JSON.stringify(company.settings.openingHours)
      : "não informado";
    return [
      `Nome: ${company.name}`,
      `Telefone/WhatsApp: ${company.whatsapp ?? company.phone ?? "não informado"}`,
      `Endereço: ${[company.addressLine, company.city, company.state].filter(Boolean).join(" - ") || "não informado"}`,
      `Taxa base de entrega: R$ ${Number(company.deliveryFeeBase ?? 0).toFixed(2)}`,
      `Tempo médio de entrega: ${company.avgDeliveryTimeMinutes ?? "não informado"} minutos`,
      `Formas de pagamento: ${paymentMethods}`,
      `Horários: ${openingHours}`,
    ].join("\n");
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
      await this.recordAiUsage(conversation.companyId, result);
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

  // -------------------------------------------------------------------------
  // Assistente do garçom — conversa privada e limitada às mesas/comandas em
  // que o próprio garçom trabalhou. Não usa ferramentas administrativas nem
  // aparece no histórico do administrador ou de outros papéis.
  // -------------------------------------------------------------------------

  async startOrGetWaiterConversation(companyId: string, userId: string) {
    const existing = await this.db().aIConversation.findFirst({
      where: { companyId, userId, channel: AIChannel.INTERNO, title: GARCOM_ASSISTANT_TITLE },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;

    return this.startConversation({
      companyId,
      agentRole: AIAgentRole.OPERACIONAL,
      channel: AIChannel.INTERNO,
      userId,
      title: GARCOM_ASSISTANT_TITLE,
    });
  }

  async getConversationForWaiter(id: string, userId: string) {
    const conversation = await this.getConversation(id);
    this.assertWaiterOwnership(conversation, userId);
    return conversation;
  }

  async sendMessageAsWaiter(id: string, userId: string, content: string) {
    const conversation = await this.getConversation(id);
    this.assertWaiterOwnership(conversation, userId);

    await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.USER, content },
    });

    const [history, company, sessions] = await Promise.all([
      this.db().aIMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } }),
      this.db().company.findUnique({ where: { id: conversation.companyId }, include: { settings: true } }),
      this.waiterSessions(conversation.companyId, userId),
    ]);
    if (!company) throw new NotFoundException("Empresa não encontrada.");

    const messages: AIChatMessage[] = [
      { role: "system", content: this.buildWaiterSystemPrompt(company.name, company.settings?.aiKnowledgeBase, sessions) },
      ...history.map((message: any) => ({
        role: message.role.toLowerCase() as AIChatMessage["role"],
        content: message.content,
        name: message.toolName ?? undefined,
      })),
    ];

    let contentToSave: string;
    try {
      const result = await this.aiProvider.chat(messages);
      await this.recordAiUsage(conversation.companyId, result);
      contentToSave = result.content?.trim() || this.fallbackWaiterAnswer(content, sessions);
    } catch {
      contentToSave = this.fallbackWaiterAnswer(content, sessions);
    }

    const assistantMessage = await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.ASSISTANT, content: contentToSave },
    });
    await this.db().aIConversation.update({ where: { id }, data: { updatedAt: new Date() } });

    return { conversationId: id, message: assistantMessage };
  }

  private assertWaiterOwnership(
    conversation: { channel: AIChannel; userId: string | null; title?: string | null },
    userId: string,
  ) {
    if (conversation.channel !== AIChannel.INTERNO || conversation.userId !== userId || conversation.title !== GARCOM_ASSISTANT_TITLE) {
      throw new ForbiddenException("Você não tem acesso a esta conversa.");
    }
  }

  private waiterSessions(companyId: string, userId: string) {
    return this.db().tableSession.findMany({
      where: {
        companyId,
        status: TableSessionStatus.ABERTA,
        OR: [
          { openedByUserId: userId },
          { orders: { some: { createdByUserId: userId } } },
        ],
      },
      include: {
        table: { select: { id: true, name: true, area: true, status: true } },
        // A conversa recebe apenas as rodadas lançadas pelo próprio garçom.
        // Isso evita que uma comanda compartilhada vire uma janela para o
        // trabalho ou os dados de outro membro da equipe.
        orders: {
          where: { createdByUserId: userId },
          include: { items: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { openedAt: "desc" },
    });
  }

  private buildWaiterSystemPrompt(companyName: string, companyKnowledgeBase: string | null | undefined, sessions: any[]) {
    return [
      `Você é o assistente privado de salão da ChegowIA para um GARÇOM da empresa "${companyName}".`,
      "Responda em português do Brasil, de forma objetiva, cordial e útil durante o atendimento no salão.",
      "Escopo absoluto: ajude apenas com as mesas e rodadas lançadas pelo próprio garçom, status de preparo/serviço, organização de atendimento, observações do pedido e orientação de salão.",
      "Nunca revele ou procure dados de outros garçons, outras mesas, administração, finanças, entregas, funcionários ou conversas. Se perguntarem algo fora desse escopo, explique brevemente que este é um assistente privado do salão.",
      "Use somente o contexto abaixo. Não invente disponibilidade, preço, tempo de preparo, pagamento ou informação de cliente.",
      "Não execute ações, não altere pedidos e não prometa que algo foi feito. Oriente o garçom a usar os controles do painel quando precisar agir.",
      "Quando útil, responda como conversa curta. Não faça texto longo sem necessidade.",
      "# Treinamento da empresa",
      companyKnowledgeBase?.trim() || "(nenhum treinamento cadastrado)",
      "# Mesas e rodadas deste garçom",
      this.formatWaiterSessions(sessions),
    ].join("\n\n");
  }

  private formatWaiterSessions(sessions: any[]) {
    if (!sessions.length) return "Você não possui nenhuma mesa ou rodada ativa no momento.";

    return sessions
      .map((session, index) => {
        const orders = session.orders.length
          ? session.orders.map((order: any) => [
            `Pedido ${order.id}: ${order.status}`,
            `Itens: ${order.items.map((item: any) => `${item.quantity}× ${item.productName}`).join(", ") || "sem itens"}`,
            order.notes ? `Observação: ${order.notes}` : null,
            `Lançado em: ${order.createdAt?.toISOString?.() ?? order.createdAt}`,
          ].filter(Boolean).join(" · ")).join("\n")
          : "Nenhuma rodada lançada por você nesta mesa.";
        return [
          `${index + 1}. ${session.table.name}${session.table.area ? ` (${session.table.area})` : ""}`,
          `Cliente: ${session.customerName ?? "Consumidor local"}`,
          `Pessoas: ${session.guestCount}`,
          `Aberta em: ${session.openedAt?.toISOString?.() ?? session.openedAt}`,
          `Suas rodadas:\n${orders}`,
        ].join("\n");
      })
      .join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Assistente da cozinha
  //
  // A cozinha era o único papel do sistema sem assistente. Diferente do
  // motoboy e do garçom, o contexto aqui **não** é filtrado por usuário: a
  // fila de produção é da cozinha inteira, e mostrar só o que uma pessoa
  // lançou não faria sentido nenhum — ninguém "tem" um pedido em preparo.
  // -------------------------------------------------------------------------

  async startOrGetKitchenConversation(companyId: string, userId: string) {
    const existing = await this.db().aIConversation.findFirst({
      where: { companyId, userId, channel: AIChannel.INTERNO, title: COZINHA_ASSISTANT_TITLE },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;

    return this.startConversation({
      companyId,
      agentRole: AIAgentRole.OPERACIONAL,
      channel: AIChannel.INTERNO,
      userId,
      title: COZINHA_ASSISTANT_TITLE,
    });
  }

  async getConversationForKitchen(id: string, userId: string) {
    const conversation = await this.getConversation(id);
    this.assertKitchenOwnership(conversation, userId);
    return conversation;
  }

  async sendMessageAsKitchen(id: string, userId: string, content: string) {
    const conversation = await this.getConversation(id);
    this.assertKitchenOwnership(conversation, userId);

    await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.USER, content },
    });

    const [history, company, fila] = await Promise.all([
      this.db().aIMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } }),
      this.db().company.findUnique({ where: { id: conversation.companyId }, include: { settings: true } }),
      this.kitchenQueue(conversation.companyId),
    ]);
    if (!company) throw new NotFoundException("Empresa não encontrada.");

    const messages: AIChatMessage[] = [
      { role: "system", content: this.buildKitchenSystemPrompt(company.name, company.settings?.aiKnowledgeBase, fila) },
      ...history.map((message: any) => ({
        role: message.role.toLowerCase() as AIChatMessage["role"],
        content: message.content,
        name: message.toolName ?? undefined,
      })),
    ];

    let contentToSave: string;
    try {
      const result = await this.aiProvider.chat(messages);
      // O consumo é da empresa, como em todo agente interno: o cozinheiro usa,
      // o admin paga. Ver test/usage-attribution.spec.ts.
      await this.recordAiUsage(conversation.companyId, result);
      contentToSave = result.content?.trim() || this.fallbackKitchenAnswer(content, fila);
    } catch {
      contentToSave = this.fallbackKitchenAnswer(content, fila);
    }

    const assistantMessage = await this.db().aIMessage.create({
      data: { conversationId: id, role: AIMessageRole.ASSISTANT, content: contentToSave },
    });
    await this.db().aIConversation.update({ where: { id }, data: { updatedAt: new Date() } });

    return { conversationId: id, message: assistantMessage };
  }

  private assertKitchenOwnership(
    conversation: { channel: AIChannel; userId: string | null; title?: string | null },
    userId: string,
  ) {
    if (
      conversation.channel !== AIChannel.INTERNO
      || conversation.userId !== userId
      || conversation.title !== COZINHA_ASSISTANT_TITLE
    ) {
      throw new ForbiddenException("Você não tem acesso a esta conversa.");
    }
  }

  /**
   * Fila de produção: delivery e salão juntos.
   *
   * A cozinha produz para os dois e não distingue a origem ao montar o prato,
   * então separá-los no contexto obrigaria a pessoa a cruzar duas listas
   * mentalmente durante o pico.
   *
   * O que **não** entra: dados do cliente, endereço e valores. A cozinha não
   * precisa disso para produzir, e incluir transformaria o assistente numa via
   * de acesso a PII que o papel não tem no resto do sistema.
   */
  private async kitchenQueue(companyId: string) {
    const [pedidos, rodadas] = await Promise.all([
      this.db().order.findMany({
        where: {
          companyId,
          status: { in: [OrderStatus.CONFIRMADO, OrderStatus.EM_PREPARO, OrderStatus.PRONTO] },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          notes: true,
          items: {
            select: { quantity: true, productName: true, variationName: true, notes: true, addons: true },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 60,
      }),
      this.db().diningOrder.findMany({
        where: {
          companyId,
          status: { in: [DiningOrderStatus.RECEBIDO, DiningOrderStatus.EM_PREPARO, DiningOrderStatus.PRONTO] },
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          notes: true,
          items: { select: { quantity: true, productName: true, notes: true } },
          tableSession: { select: { table: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
        take: 60,
      }),
    ]);

    return { pedidos, rodadas };
  }

  private buildKitchenSystemPrompt(
    companyName: string,
    companyKnowledgeBase: string | null | undefined,
    fila: { pedidos: any[]; rodadas: any[] },
  ) {
    return [
      `Você é o assistente privado de produção da ChegowIA para a COZINHA da empresa "${companyName}".`,
      "Responda em português do Brasil, de forma curta e direta — quem lê está com as mãos ocupadas.",
      "Escopo absoluto: fila de produção, o que preparar primeiro, itens de cada pedido, observações e restrições do cliente, e o que já está pronto aguardando retirada.",
      "Nunca revele nome, telefone, endereço ou valor de cliente, dados de outros funcionários, finanças, entregas ou conversas. Se perguntarem, explique que este assistente é privado da produção.",
      "Use somente o contexto abaixo. Não invente tempo de preparo, disponibilidade de insumo nem item que não esteja no pedido.",
      "Não execute ações e não prometa que algo foi feito: quem muda o status do pedido é a pessoa, no painel.",
      "Ao priorizar, considere o tempo de espera: o pedido mais antigo ainda não pronto é o mais urgente.",
      "# Treinamento da empresa",
      companyKnowledgeBase?.trim() || "(nenhum treinamento cadastrado)",
      "# Fila de produção agora",
      this.formatKitchenQueue(fila),
    ].join("\n\n");
  }

  private formatKitchenQueue(fila: { pedidos: any[]; rodadas: any[] }) {
    const minutos = (data: any) => {
      const instante = data instanceof Date ? data.getTime() : new Date(data).getTime();
      return Math.max(0, Math.round((Date.now() - instante) / 60_000));
    };

    const linhasPedido = fila.pedidos.map((pedido) => {
      const itens = pedido.items
        .map((item: any) => [
          `${item.quantity}× ${item.productName}`,
          item.variationName ? `(${item.variationName})` : null,
          Array.isArray(item.addons) && item.addons.length
            ? `+ ${item.addons.map((addon: any) => addon.name).join(", ")}`
            : null,
          item.notes ? `— ${item.notes}` : null,
        ].filter(Boolean).join(" "))
        .join("; ");
      return [
        `Delivery ${pedido.id.slice(-6)} · ${pedido.status} · esperando há ${minutos(pedido.createdAt)} min`,
        `Itens: ${itens || "sem itens"}`,
        pedido.notes ? `Observação do pedido: ${pedido.notes}` : null,
      ].filter(Boolean).join("\n");
    });

    const linhasRodada = fila.rodadas.map((rodada) => {
      const itens = rodada.items
        .map((item: any) => `${item.quantity}× ${item.productName}${item.notes ? ` — ${item.notes}` : ""}`)
        .join("; ");
      const mesa = rodada.tableSession?.table?.name ?? "mesa";
      return [
        `Salão ${mesa} · ${rodada.status} · esperando há ${minutos(rodada.createdAt)} min`,
        `Itens: ${itens || "sem itens"}`,
        rodada.notes ? `Observação: ${rodada.notes}` : null,
      ].filter(Boolean).join("\n");
    });

    const todas = [...linhasPedido, ...linhasRodada];
    if (!todas.length) return "Nenhum pedido na fila de produção agora.";
    return todas.join("\n\n");
  }

  /**
   * Resposta sem IA, para quando o provedor falha. A cozinha não pode ficar
   * sem resposta no meio do pico só porque a API caiu.
   */
  private fallbackKitchenAnswer(question: string, fila: { pedidos: any[]; rodadas: any[] }) {
    const normalized = question
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const emProducao = [
      ...fila.pedidos.filter((p) => p.status !== OrderStatus.PRONTO),
      ...fila.rodadas.filter((r) => r.status !== DiningOrderStatus.PRONTO),
    ];
    const prontos = [
      ...fila.pedidos.filter((p) => p.status === OrderStatus.PRONTO),
      ...fila.rodadas.filter((r) => r.status === DiningOrderStatus.PRONTO),
    ];

    if (!fila.pedidos.length && !fila.rodadas.length) return "Nenhum pedido na fila agora.";
    if (/\b(oi|ola|bom dia|boa tarde|boa noite|e ai)\b/.test(normalized)) {
      return `Fila agora: ${emProducao.length} em produção e ${prontos.length} pronto(s) aguardando retirada.`;
    }
    if (normalized.includes("pronto")) {
      if (!prontos.length) return "Nada pronto aguardando retirada no momento.";
      return `${prontos.length} pedido(s) pronto(s) aguardando retirada.`;
    }
    if (normalized.includes("prim") || normalized.includes("urgen") || normalized.includes("atras")) {
      const [maisAntigo] = emProducao;
      if (!maisAntigo) return "Nada em produção no momento.";
      const itens = maisAntigo.items.map((item: any) => `${item.quantity}× ${item.productName}`).join(", ");
      return `Comece pelo mais antigo em produção: ${itens}.`;
    }
    return `Fila: ${emProducao.length} em produção, ${prontos.length} pronto(s). Posso ajudar com prioridade, itens e observações.`;
  }

  private fallbackWaiterAnswer(question: string, sessions: any[]) {
    const normalized = question
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const orders = sessions.flatMap((session) => session.orders.map((order: any) => ({ ...order, table: session.table })));

    if (!sessions.length) return "Você não possui mesas ou rodadas ativas no momento.";
    if (/\b(oi|ola|bom dia|boa tarde|boa noite|e ai)\b/.test(normalized)) {
      return "Estou por aqui para ajudar com suas mesas, rodadas lançadas, pedidos prontos e o que falta servir.";
    }
    if (normalized.includes("pronto")) {
      const ready = orders.filter((order: any) => order.status === DiningOrderStatus.PRONTO);
      if (!ready.length) return "Não encontrei nenhum pedido seu marcado como pronto agora.";
      return ready.map((order: any) => `${order.table.name}: ${order.items.map((item: any) => `${item.quantity}× ${item.productName}`).join(", ")}`).join("\n");
    }
    if (normalized.includes("status") || normalized.includes("resumo") || normalized.includes("mesa") || normalized.includes("pedido") || normalized.includes("servir")) {
      return sessions.map((session) => `${session.table.name}: ${session.orders.length ? session.orders.map((order: any) => order.status).join(", ") : "nenhuma rodada sua"}`).join("\n");
    }
    return "Este assistente é privado do salão. Posso ajudar com suas mesas, suas rodadas, pedidos prontos e o que falta servir.";
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
