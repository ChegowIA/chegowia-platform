import { AIAgentRole, AIChannel, OrderSource, PaymentMethod, WhatsAppOrderDraftStatus } from "@prisma/client";
import { AiService } from "../src/ai/ai.service";
import { OrdersService, PreparedWhatsAppCheckout, whatsappCheckoutFingerprint } from "../src/orders/orders.service";
import { WhatsAppOrdersService } from "../src/orders/whatsapp-orders.service";

/**
 * Pedido pelo WhatsApp não tem sessão autenticada do cliente. Estes testes
 * protegem justamente as três coisas que não podem depender do modelo de IA:
 * empresa/conversa corretas, frete calculado no servidor e criação idempotente
 * sem fabricar uma conta de usuário.
 */
describe("checkout automatizado pelo WhatsApp", () => {
  const companyId = "empresa-alfa";
  const aiConversationId = "ai-conversa-alfa";
  const conversation = {
    id: "whatsapp-conversa-alfa",
    companyId,
    aiConversationId,
    customerPhone: "5531999999999",
    customerName: "Ana",
  };

  function checkout(): PreparedWhatsAppCheckout {
    return {
      items: [{
        productId: "produto-alfa",
        productName: "X-Burger",
        quantity: 2,
        unitPrice: 25,
        unitCost: null,
        variationId: null,
        variationName: null,
        variationPriceDelta: 0,
        addonIds: [],
        addons: [],
        notes: null,
        totalPrice: 50,
      }],
      address: {
        street: "Rua das Flores",
        number: "42",
        complement: null,
        neighborhood: "Centro",
        city: "Belo Horizonte",
        state: "MG",
        zipCode: "30110000",
        reference: null,
        latitude: -19.92,
        longitude: -43.94,
      },
      paymentMethod: PaymentMethod.PIX_MANUAL,
      subtotal: 50,
      deliveryFee: 7.5,
      distanceKm: 3.2,
      durationMinutes: 11,
      total: 57.5,
    };
  }

  function draft(overrides: Record<string, unknown> = {}) {
    return {
      id: "rascunho-alfa",
      companyId,
      conversationId: conversation.id,
      activeKey: `${companyId}:${conversation.id}`,
      status: WhatsAppOrderDraftStatus.MONTANDO,
      cart: [],
      customerName: "Ana",
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressNeighborhood: null,
      addressCity: null,
      addressState: null,
      addressZipCode: null,
      addressReference: null,
      addressLatitude: null,
      addressLongitude: null,
      paymentMethod: null,
      notes: null,
      quoteSnapshot: null,
      quoteFingerprint: null,
      confirmationRequestedAt: null,
      confirmedAt: null,
      completedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function whatsappService(initialDraft = draft()) {
    const state = { draft: initialDraft as any };
    const prisma: any = {
      whatsAppConversation: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.companyId === companyId && where.aiConversationId === aiConversationId) return conversation;
          return null;
        }),
      },
      whatsAppOrderDraft: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => (
          where.companyId === companyId && where.activeKey === state.draft.activeKey ? state.draft : null
        )),
        create: jest.fn().mockImplementation(({ data }: any) => {
          state.draft = { ...state.draft, ...data };
          return state.draft;
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          expect(where.id_companyId).toEqual({ id: state.draft.id, companyId });
          state.draft = { ...state.draft, ...data, updatedAt: new Date() };
          return state.draft;
        }),
      },
      product: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const orders = {
      quoteWhatsAppDelivery: jest.fn().mockResolvedValue({
        distanceKm: 3.2,
        durationMinutes: 11,
        deliveryFee: 7.5,
        latitude: -19.92,
        longitude: -43.94,
      }),
      prepareWhatsAppCheckout: jest.fn().mockResolvedValue(checkout()),
      createWhatsAppOrder: jest.fn().mockResolvedValue({
        created: true,
        order: {
          id: "pedido-whatsapp-1",
          status: "RECEBIDO",
          subtotal: 50,
          deliveryFee: 7.5,
          deliveryDistanceKm: 3.2,
          deliveryRouteDurationMinutes: 11,
          total: 57.5,
          paymentMethod: PaymentMethod.PIX_MANUAL,
          items: [{ productName: "X-Burger", quantity: 2, totalPrice: 50 }],
        },
      }),
    };
    const realtime = { emitToCompany: jest.fn() };
    return {
      service: new WhatsAppOrdersService(prisma as never, orders as never, realtime as never),
      prisma,
      orders,
      realtime,
      state,
    };
  }

  it("resolve a conversa pela empresa e calcula a rota/frete real ao salvar endereço", async () => {
    const { service, prisma, orders, state } = whatsappService();

    await service.setDeliveryAddress(companyId, aiConversationId, {
      street: "Rua das Flores",
      number: "42",
      neighborhood: "Centro",
      city: "Belo Horizonte",
      state: "mg",
      zipCode: "30110-000",
    });

    expect(prisma.whatsAppConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId, aiConversationId },
    }));
    expect(orders.quoteWhatsAppDelivery).toHaveBeenCalledWith(companyId, expect.objectContaining({
      street: "Rua das Flores",
      state: "MG",
      zipCode: "30110000",
    }));
    expect(state.draft.addressLatitude).toBe(-19.92);
    expect(state.draft.quoteSnapshot).toMatchObject({
      type: "delivery_estimate",
      delivery: { deliveryFee: 7.5, distanceKm: 3.2 },
    });
  });

  it("não aceita um 'sim' genérico como autorização para criar a venda", async () => {
    const prepared = checkout();
    const { service, orders } = whatsappService(draft({
      status: WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO,
      cart: [{ id: "linha-1", productId: "produto-alfa", quantity: 2, variationId: null, addonIds: [], notes: null }],
      addressStreet: prepared.address.street,
      addressNumber: prepared.address.number,
      addressNeighborhood: prepared.address.neighborhood,
      addressCity: prepared.address.city,
      addressState: prepared.address.state,
      addressZipCode: prepared.address.zipCode,
      paymentMethod: prepared.paymentMethod,
      quoteFingerprint: whatsappCheckoutFingerprint(prepared),
    }));

    const result = await service.confirmOrder(companyId, aiConversationId, "sim");

    expect(result).toMatchObject({ confirmed: false });
    expect(orders.createWhatsAppOrder).not.toHaveBeenCalled();
  });

  it("cria o pedido com o telefone da conversa e sem conta/login do cliente", async () => {
    const prepared = checkout();
    const { service, orders, state } = whatsappService(draft({
      status: WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO,
      cart: [{ id: "linha-1", productId: "produto-alfa", quantity: 2, variationId: null, addonIds: [], notes: null }],
      addressStreet: prepared.address.street,
      addressNumber: prepared.address.number,
      addressNeighborhood: prepared.address.neighborhood,
      addressCity: prepared.address.city,
      addressState: prepared.address.state,
      addressZipCode: prepared.address.zipCode,
      paymentMethod: prepared.paymentMethod,
      quoteFingerprint: whatsappCheckoutFingerprint(prepared),
    }));

    const result = await service.confirmOrder(companyId, aiConversationId, "CONFIRMAR");

    expect(orders.createWhatsAppOrder).toHaveBeenCalledWith(companyId, expect.objectContaining({
      draftId: "rascunho-alfa",
      conversationId: conversation.id,
      customerName: "Ana",
      customerPhone: conversation.customerPhone,
      expectedFingerprint: whatsappCheckoutFingerprint(prepared),
    }));
    expect(state.draft.status).toBe(WhatsAppOrderDraftStatus.CONCLUIDO);
    expect(result).toMatchObject({ confirmed: true, created: true, order: { id: "pedido-whatsapp-1" } });
  });

  it("abre um novo carrinho depois de concluir, sem reutilizar o rascunho já ligado ao pedido anterior", async () => {
    const { service, prisma } = whatsappService(draft({
      status: WhatsAppOrderDraftStatus.CONCLUIDO,
      activeKey: null,
      completedAt: new Date(),
    }));

    await service.getDraft(companyId, aiConversationId);

    expect(prisma.whatsAppOrderDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId,
        conversationId: conversation.id,
        activeKey: `${companyId}:${conversation.id}`,
      }),
    }));
  });

  it("persiste no Order como venda WhatsApp sem customerId artificial", async () => {
    const prepared = checkout();
    const prisma: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pedido-1", companyId, items: [] }),
      },
      whatsAppOrderDraft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));
    const realtime = { emitToCompany: jest.fn() };
    const orders = new OrdersService(prisma as never, realtime as never, {} as never, { emitForOrder: jest.fn() } as never);
    jest.spyOn(orders, "prepareWhatsAppCheckout").mockResolvedValue(prepared);

    await orders.createWhatsAppOrder(companyId, {
      draftId: "rascunho-alfa",
      conversationId: conversation.id,
      customerName: "Ana",
      customerPhone: conversation.customerPhone,
      items: [],
      address: prepared.address,
      paymentMethod: prepared.paymentMethod,
      expectedFingerprint: whatsappCheckoutFingerprint(prepared),
    });

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyId,
        customerId: null,
        customerName: "Ana",
        customerPhone: conversation.customerPhone,
        source: OrderSource.WHATSAPP,
        whatsappConversationId: conversation.id,
        whatsappOrderDraftId: "rascunho-alfa",
      }),
    }));
    expect(realtime.emitToCompany).toHaveBeenCalledWith(companyId, "order.created", expect.anything());
  });

  it("não entrega ferramentas de pedido ao chat público nem aceita tool call forjada fora do WhatsApp", async () => {
    const tools = { confirmWhatsAppOrder: jest.fn() };
    const ai = new AiService(
      {} as never,
      {} as never,
      {} as never,
      tools as never,
      {} as never,
      {} as never,
    ) as any;

    const publicTools = ai.toolsForRole(AIAgentRole.ATENDIMENTO, AIChannel.CLIENTE);
    const whatsappTools = ai.toolsForRole(AIAgentRole.ATENDIMENTO, AIChannel.WHATSAPP);
    const forged = await ai.executeTool(
      "confirmWhatsAppOrder",
      { id: "ai-publica", companyId, agentRole: AIAgentRole.ATENDIMENTO, channel: AIChannel.CLIENTE },
      {},
      "CONFIRMAR",
    );

    expect(publicTools.some((tool: any) => tool.name === "confirmWhatsAppOrder")).toBe(false);
    expect(whatsappTools.some((tool: any) => tool.name === "confirmWhatsAppOrder")).toBe(true);
    expect(forged).toMatchObject({ error: expect.stringMatching(/WhatsApp/i) });
    expect(tools.confirmWhatsAppOrder).not.toHaveBeenCalled();
  });

  it("usa confirmação determinística no WhatsApp em vez de depender da decisão do provedor de IA", async () => {
    const createdMessages: any[] = [];
    const prisma: any = {
      aIConversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: aiConversationId,
          companyId,
          agentRole: AIAgentRole.ATENDIMENTO,
          channel: AIChannel.WHATSAPP,
          messages: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ id: companyId, name: "Loja Alfa", settings: {} }) },
      aIMessage: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const message = { id: `msg-${createdMessages.length + 1}`, ...data };
          createdMessages.push(message);
          return Promise.resolve(message);
        }),
        findMany: jest.fn(),
      },
    };
    const provider = { chat: jest.fn() };
    const tools = {
      confirmWhatsAppOrder: jest.fn().mockResolvedValue({
        confirmed: true,
        created: true,
        order: {
          id: "pedido-1",
          shortCode: "IDO-001",
          deliveryFee: 7.5,
          total: 57.5,
          items: [{ name: "X-Burger", quantity: 2, totalPrice: 50 }],
        },
      }),
    };
    const ai = new AiService(prisma as never, provider as never, {} as never, tools as never, {} as never, {} as never);

    const result = await ai.sendMessage(aiConversationId, "CONFIRMAR");

    expect(tools.confirmWhatsAppOrder).toHaveBeenCalledWith(companyId, aiConversationId, "CONFIRMAR");
    expect(provider.chat).not.toHaveBeenCalled();
    expect(result.message.content).toContain("Pedido #IDO-001 confirmado");
    expect(createdMessages).toHaveLength(2);
  });
});
