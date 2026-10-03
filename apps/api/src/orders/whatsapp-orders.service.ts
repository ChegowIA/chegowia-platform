import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentMethod, WhatsAppOrderDraftStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { tenantContext } from "../common/tenant/tenant-context";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  OrdersService,
  PreparedWhatsAppCheckout,
  TrustedOrderItemInput,
  WhatsAppDeliveryAddress,
  whatsappCheckoutFingerprint,
} from "./orders.service";

type CartOperation = "ADD" | "SET" | "REMOVE" | "CLEAR";

interface CartLine extends TrustedOrderItemInput {
  id: string;
  variationId?: string | null;
  addonIds: string[];
  optionSelections: Array<{ groupId: string; optionIds: string[] }>;
  notes?: string | null;
}

interface WhatsAppConversationContext {
  id: string;
  companyId: string;
  aiConversationId: string | null;
  customerPhone: string;
  customerName: string | null;
}

const MAX_CART_LINES = 40;

/**
 * Estado de checkout do WhatsApp.
 *
 * Ele existe fora de MessagingService para manter a responsabilidade de vendas
 * num único módulo. A única chave recebida da IA é o ID da conversa de IA; a
 * conversa do WhatsApp, empresa, telefone e rascunho são todos re-resolvidos
 * no banco antes de qualquer leitura ou escrita.
 */
@Injectable()
export class WhatsAppOrdersService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private db() {
    return this.prisma as any;
  }

  private scoped<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.runAsCompany(companyId, fn);
  }

  async getDraft(companyId: string, aiConversationId: string) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      return this.presentDraft(context);
    });
  }

  async updateCart(
    companyId: string,
    aiConversationId: string,
    input: {
      operation: CartOperation;
      lineId?: string;
      productId?: string;
      quantity?: number;
      variationId?: string;
      addonIds?: string[];
      optionSelections?: Array<{ groupId?: string; optionIds?: string[] }>;
      notes?: string;
    },
  ) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const operation = String(input.operation ?? "").trim().toUpperCase() as CartOperation;
      const cart = readCart(context.draft.cart);

      if (operation === "CLEAR") {
        const draft = await this.saveDraft(context, { cart: [], ...this.invalidatedProposalData() });
        return this.presentDraft({ ...context, draft });
      }

      if (operation === "REMOVE" || operation === "SET") {
        const lineId = cleanIdentifier(input.lineId);
        if (!lineId) throw new BadRequestException("Informe o item do carrinho que deve ser alterado.");
        const index = cart.findIndex((line) => line.id === lineId);
        if (index === -1) throw new NotFoundException("Esse item não está mais no carrinho.");
        if (operation === "REMOVE") {
          cart.splice(index, 1);
        } else {
          cart[index] = { ...cart[index], quantity: normalizeQuantity(input.quantity) };
        }
      } else if (operation === "ADD") {
        const productId = cleanIdentifier(input.productId);
        if (!productId) throw new BadRequestException("Escolha um produto do cardápio para adicionar.");
        const nextLine: CartLine = {
          id: randomUUID(),
          productId,
          quantity: normalizeQuantity(input.quantity),
          variationId: cleanIdentifier(input.variationId) || null,
          addonIds: normalizeIds(input.addonIds),
          optionSelections: normalizeOptionSelections(input.optionSelections),
          notes: cleanOptionalText(input.notes, 500),
        };
        await this.assertCartLineAvailable(nextLine);
        const sameLine = cart.find((line) => cartLineKey(line) === cartLineKey(nextLine));
        if (sameLine) {
          sameLine.quantity = normalizeQuantity(sameLine.quantity + nextLine.quantity);
        } else {
          if (cart.length >= MAX_CART_LINES) throw new BadRequestException("O carrinho pode ter no máximo 40 itens diferentes.");
          cart.push(nextLine);
        }
      } else {
        throw new BadRequestException("Operação de carrinho inválida.");
      }

      const draft = await this.saveDraft(context, { cart, ...this.invalidatedProposalData() });
      return this.presentDraft({ ...context, draft });
    });
  }

  async setCustomerName(companyId: string, aiConversationId: string, input: { customerName: string }) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const customerName = requiredText(input.customerName, "Informe como podemos chamar você.", 191);
      const draft = await this.saveDraft(context, { customerName, ...this.invalidatedProposalData() });
      return this.presentDraft({ ...context, draft });
    });
  }

  /** Salva o endereço e imediatamente calcula a rota/frete reais no servidor. */
  async setDeliveryAddress(
    companyId: string,
    aiConversationId: string,
    input: Partial<WhatsAppDeliveryAddress> & { customerName?: string },
  ) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const address = normalizeAddress(input);
      const customerName = input.customerName === undefined
        ? context.draft.customerName
        : requiredText(input.customerName, "Informe como podemos chamar você.", 191);
      const draftWithAddress = await this.saveDraft(context, {
        customerName,
        addressStreet: address.street,
        addressNumber: address.number,
        addressComplement: address.complement ?? null,
        addressNeighborhood: address.neighborhood,
        addressCity: address.city,
        addressState: address.state,
        addressZipCode: address.zipCode ?? null,
        addressReference: address.reference ?? null,
        addressLatitude: null,
        addressLongitude: null,
        ...this.invalidatedProposalData(),
      });

      try {
        // Não chama uma URL interna: usa o mesmo serviço de geocoding/rota que
        // sustenta a rota de cotação autenticada, evitando duplicidade e preço
        // divergente entre site e WhatsApp.
        const quote = await this.orders.quoteWhatsAppDelivery(companyId, address);
        const draft = await this.saveDraft({ ...context, draft: draftWithAddress }, {
          addressLatitude: quote.latitude,
          addressLongitude: quote.longitude,
          quoteSnapshot: {
            type: "delivery_estimate",
            calculatedAt: new Date().toISOString(),
            delivery: {
              distanceKm: quote.distanceKm,
              durationMinutes: quote.durationMinutes,
              deliveryFee: quote.deliveryFee,
            },
          },
          lastError: null,
        });
        return this.presentDraft({ ...context, draft });
      } catch (error) {
        await this.saveDraft({ ...context, draft: draftWithAddress }, {
          lastError: publicErrorMessage(error),
        });
        throw error;
      }
    });
  }

  async setPaymentMethod(companyId: string, aiConversationId: string, input: { paymentMethod: PaymentMethod }) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const paymentMethod = normalizePaymentMethod(input.paymentMethod);
      const draft = await this.saveDraft(context, { paymentMethod, ...this.invalidatedProposalData() });
      return this.presentDraft({ ...context, draft });
    });
  }

  async setOrderNotes(companyId: string, aiConversationId: string, input: { notes?: string }) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const draft = await this.saveDraft(context, {
        notes: cleanOptionalText(input.notes, 1_000),
        ...this.invalidatedProposalData(),
      });
      return this.presentDraft({ ...context, draft });
    });
  }

  /** Gera a proposta final e pede a palavra de confirmação definida pela plataforma. */
  async prepareConfirmation(companyId: string, aiConversationId: string) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      this.assertDraftEditable(context.draft);
      const checkout = await this.buildCheckout(context);
      const snapshot = proposalSnapshot(checkout);
      const draft = await this.saveDraft(context, {
        status: WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO,
        quoteSnapshot: snapshot,
        quoteFingerprint: whatsappCheckoutFingerprint(checkout),
        confirmationRequestedAt: new Date(),
        lastError: null,
      });
      this.emitDraftUpdated(companyId, context.conversation.id, draft);
      return {
        ...this.proposalResult(snapshot, draft.status),
        nextStep: "Peça para o cliente responder exatamente CONFIRMAR. Não crie o pedido antes dessa resposta.",
      };
    });
  }

  /**
   * A própria mensagem recebida é verificada no servidor. Mesmo que o modelo
   * tente chamar a tool por engano, ele não consegue criar pedido sem uma
   * confirmação textual inequívoca do cliente.
   */
  async confirmOrder(companyId: string, aiConversationId: string, customerMessage: string) {
    return this.scoped(companyId, async () => {
      const context = await this.getContext(companyId, aiConversationId);
      const existing = await this.findExistingOrder(companyId, context.draft.id);
      if (existing) return orderResult(existing, false);

      if (!hasExplicitConfirmation(customerMessage)) {
        return {
          confirmed: false,
          message: "Ainda não criei o pedido. Para autorizar a compra, peça que o cliente responda exatamente CONFIRMAR após receber o resumo.",
        };
      }
      if (context.draft.status !== WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO || !context.draft.quoteFingerprint) {
        throw new BadRequestException("Mostre o resumo atualizado e peça CONFIRMAR antes de finalizar o pedido.");
      }

      const checkout = await this.buildCheckout(context);
      const fingerprint = whatsappCheckoutFingerprint(checkout);
      if (fingerprint !== context.draft.quoteFingerprint) {
        const snapshot = proposalSnapshot(checkout);
        const draft = await this.saveDraft(context, {
          quoteSnapshot: snapshot,
          quoteFingerprint: fingerprint,
          confirmationRequestedAt: new Date(),
          lastError: null,
        });
        this.emitDraftUpdated(companyId, context.conversation.id, draft);
        return {
          confirmed: false,
          requiresNewConfirmation: true,
          message: "O cardápio, a rota ou o valor foi atualizado. Mostre o novo resumo e peça CONFIRMAR novamente.",
          ...this.proposalResult(snapshot, draft.status),
        };
      }

      try {
        const result = await this.orders.createWhatsAppOrder(companyId, {
          draftId: context.draft.id,
          conversationId: context.conversation.id,
          customerName: this.customerNameFor(context),
          customerPhone: context.conversation.customerPhone,
          items: readCart(context.draft.cart),
          address: addressFromDraft(context.draft),
          paymentMethod: normalizePaymentMethod(context.draft.paymentMethod),
          notes: context.draft.notes,
          expectedFingerprint: fingerprint,
        });
        const draft = await this.saveDraft(context, {
          status: WhatsAppOrderDraftStatus.CONCLUIDO,
          activeKey: null,
          confirmedAt: new Date(),
          completedAt: new Date(),
          lastError: null,
        });
        this.emitDraftUpdated(companyId, context.conversation.id, draft);
        return orderResult(result.order, result.created);
      } catch (error) {
        // Entre a prévia e o INSERT o cardápio pode ter mudado. Atualizamos a
        // proposta e exigimos nova confirmação; nunca criamos pelo valor antigo.
        if (error instanceof ConflictException) {
          const refreshed = await this.buildCheckout(context);
          const snapshot = proposalSnapshot(refreshed);
          const draft = await this.saveDraft(context, {
            status: WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO,
            quoteSnapshot: snapshot,
            quoteFingerprint: whatsappCheckoutFingerprint(refreshed),
            confirmationRequestedAt: new Date(),
            lastError: null,
          });
          this.emitDraftUpdated(companyId, context.conversation.id, draft);
          return {
            confirmed: false,
            requiresNewConfirmation: true,
            message: "O valor foi atualizado no instante de finalizar. Mostre o novo resumo e peça CONFIRMAR novamente.",
            ...this.proposalResult(snapshot, draft.status),
          };
        }
        await this.saveDraft(context, { lastError: publicErrorMessage(error) });
        throw error;
      }
    });
  }

  private async getContext(companyId: string, aiConversationId: string): Promise<{ conversation: WhatsAppConversationContext; draft: any }> {
    const conversation = await this.db().whatsAppConversation.findFirst({
      where: { companyId, aiConversationId },
      select: {
        id: true,
        companyId: true,
        aiConversationId: true,
        customerPhone: true,
        customerName: true,
      },
    });
    if (!conversation) {
      throw new NotFoundException("Não encontrei a conversa de WhatsApp vinculada a este atendimento.");
    }
    const activeKey = activeDraftKey(companyId, conversation.id);
    let draft = await this.db().whatsAppOrderDraft.findFirst({ where: { companyId, activeKey } });
    if (!draft) {
      try {
        draft = await this.db().whatsAppOrderDraft.create({
          data: {
            companyId,
            conversationId: conversation.id,
            activeKey,
            customerName: conversation.customerName,
          },
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        draft = await this.db().whatsAppOrderDraft.findFirst({ where: { companyId, activeKey } });
      }
    }
    if (!draft) throw new NotFoundException("Não foi possível preparar o pedido desta conversa.");
    return { conversation, draft };
  }

  private async saveDraft(context: { conversation: WhatsAppConversationContext; draft: any }, data: Record<string, unknown>) {
    const draft = await this.db().whatsAppOrderDraft.update({
      where: { id_companyId: { id: context.draft.id, companyId: context.conversation.companyId } },
      data,
    });
    this.emitDraftUpdated(context.conversation.companyId, context.conversation.id, draft);
    return draft;
  }

  private async assertCartLineAvailable(line: CartLine) {
    const product = await this.db().product.findFirst({
      where: { id: line.productId, isActive: true },
      include: {
        variations: { where: { isActive: true }, select: { id: true } },
        addons: { where: { isActive: true }, select: { id: true } },
        optionGroups: {
          where: { isActive: true },
          select: { id: true, options: { where: { isActive: true }, select: { id: true } } },
        },
      },
    });
    if (!product) throw new BadRequestException("Esse produto não está disponível nesta empresa.");
    if (line.variationId && !product.variations.some((variation: any) => variation.id === line.variationId)) {
      throw new BadRequestException("A variação escolhida não está disponível para esse produto.");
    }
    const availableAddons = new Set(product.addons.map((addon: any) => addon.id));
    if (line.addonIds.some((addonId) => !availableAddons.has(addonId))) {
      throw new BadRequestException("Um adicional escolhido não está disponível para esse produto.");
    }
    const availableGroups = new Map<string, Set<string>>(
      (product.optionGroups ?? []).map((group: any) => [
        String(group.id),
        new Set<string>((group.options ?? []).map((option: any) => String(option.id))),
      ]),
    );
    for (const selection of line.optionSelections) {
      const availableOptions = availableGroups.get(selection.groupId);
      if (!availableOptions || selection.optionIds.some((optionId) => !availableOptions.has(optionId))) {
        throw new BadRequestException("Uma escolha configurável não está disponível para esse produto.");
      }
    }
  }

  private async buildCheckout(context: { conversation: WhatsAppConversationContext; draft: any }) {
    const cart = readCart(context.draft.cart);
    if (!cart.length) throw new BadRequestException("Adicione ao menos um item antes de fechar o pedido.");
    const address = addressFromDraft(context.draft);
    const paymentMethod = normalizePaymentMethod(context.draft.paymentMethod);
    this.customerNameFor(context);
    return this.orders.prepareWhatsAppCheckout(context.conversation.companyId, {
      items: cart,
      address,
      paymentMethod,
    });
  }

  private customerNameFor(context: { conversation: WhatsAppConversationContext; draft: any }) {
    const name = cleanOptionalText(context.draft.customerName ?? context.conversation.customerName, 191);
    if (!name) throw new BadRequestException("Antes de fechar, pergunte o nome do cliente.");
    return name;
  }

  private async presentDraft(context: { conversation: WhatsAppConversationContext; draft: any }) {
    const cart = readCart(context.draft.cart);
    const productIds = [...new Set(cart.map((line) => line.productId))];
    const products = productIds.length
      ? await this.db().product.findMany({
          where: { id: { in: productIds }, isActive: true },
          include: {
            variations: { where: { isActive: true }, select: { id: true, name: true, priceDelta: true } },
            addons: { where: { isActive: true }, select: { id: true, name: true, price: true } },
            optionGroups: {
              where: { isActive: true },
              orderBy: { position: "asc" },
              select: {
                id: true,
                name: true,
                pricingRule: true,
                options: { where: { isActive: true }, orderBy: { position: "asc" }, select: { id: true, name: true, priceDelta: true } },
              },
            },
          },
        })
      : [];
    const productMap = new Map(products.map((product: any) => [product.id, product]));
    const items = cart.map((line) => {
      const product = productMap.get(line.productId) as any;
      const variation = line.variationId ? product?.variations.find((item: any) => item.id === line.variationId) : null;
      const addons = line.addonIds.map((id) => product?.addons.find((item: any) => item.id === id)).filter(Boolean);
      const optionSelections = line.optionSelections.map((selection) => {
        const group = product?.optionGroups.find((item: any) => item.id === selection.groupId);
        const options = selection.optionIds.map((id) => group?.options.find((item: any) => item.id === id)).filter(Boolean);
        return group ? {
          id: group.id,
          name: group.name,
          pricingRule: group.pricingRule,
          options: options.map((option: any) => ({ id: option.id, name: option.name, priceDelta: Number(option.priceDelta) })),
        } : null;
      }).filter(Boolean);
      return {
        lineId: line.id,
        productId: line.productId,
        name: product?.name ?? "Item indisponível",
        quantity: line.quantity,
        variation: variation ? { id: variation.id, name: variation.name, priceDelta: Number(variation.priceDelta) } : null,
        addons: addons.map((addon: any) => ({ id: addon.id, name: addon.name, price: Number(addon.price) })),
        optionSelections,
        notes: line.notes ?? null,
      };
    });
    const snapshot = asRecord(context.draft.quoteSnapshot);
    const proposal = snapshot?.type === "proposal" ? snapshot : null;
    const deliveryEstimate = snapshot?.type === "delivery_estimate" ? snapshot.delivery : proposal?.checkout?.delivery;
    return {
      status: context.draft.status,
      customerName: context.draft.customerName ?? context.conversation.customerName ?? null,
      customerPhone: context.conversation.customerPhone,
      cart: items,
      address: draftAddressView(context.draft),
      paymentMethod: context.draft.paymentMethod ?? null,
      notes: context.draft.notes ?? null,
      deliveryEstimate: deliveryEstimate ?? null,
      proposal: proposal ? this.proposalResult(proposal, context.draft.status) : null,
      pendingConfirmation: context.draft.status === WhatsAppOrderDraftStatus.AGUARDANDO_CONFIRMACAO,
      nextSteps: nextSteps(context.draft, cart.length),
      lastError: context.draft.lastError ?? null,
    };
  }

  private proposalResult(snapshot: any, status: WhatsAppOrderDraftStatus) {
    const checkout = snapshot.checkout;
    return {
      status,
      confirmationKeyword: "CONFIRMAR",
      summary: {
        items: checkout.items,
        subtotal: checkout.subtotal,
        deliveryFee: checkout.delivery.deliveryFee,
        distanceKm: checkout.delivery.distanceKm,
        durationMinutes: checkout.delivery.durationMinutes,
        total: checkout.total,
        paymentMethod: checkout.paymentMethod,
        address: checkout.address,
        notes: checkout.notes ?? null,
      },
    };
  }

  private invalidatedProposalData() {
    return {
      status: WhatsAppOrderDraftStatus.MONTANDO,
      quoteSnapshot: null,
      quoteFingerprint: null,
      confirmationRequestedAt: null,
      confirmedAt: null,
      lastError: null,
    };
  }

  private assertDraftEditable(draft: any) {
    if (draft.status === WhatsAppOrderDraftStatus.CONCLUIDO) {
      throw new ConflictException("Esse pedido já foi confirmado. Inicie um novo pedido para alterar itens ou endereço.");
    }
  }

  private async findExistingOrder(companyId: string, draftId: string) {
    return this.db().order.findFirst({
      where: { companyId, whatsappOrderDraftId: draftId },
      include: { items: true, delivery: true, payment: true },
    });
  }

  private emitDraftUpdated(companyId: string, conversationId: string, draft: any) {
    this.realtime.emitToCompany(companyId, "whatsapp.order_draft_updated", {
      conversationId,
      status: draft.status,
      updatedAt: draft.updatedAt,
    });
  }
}

function normalizeQuantity(value: unknown) {
  const quantity = Number(value ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new BadRequestException("A quantidade deve ser um número inteiro entre 1 e 99.");
  }
  return quantity;
}

function normalizeIds(values: unknown) {
  if (!Array.isArray(values)) return [];
  if (values.length > 20) throw new BadRequestException("Um item pode ter no máximo 20 adicionais.");
  return [...new Set(values.map(cleanIdentifier).filter((value): value is string => Boolean(value)))].sort();
}

function normalizeOptionSelections(value: unknown): Array<{ groupId: string; optionIds: string[] }> {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) throw new BadRequestException("Um item pode ter no máximo 20 grupos de escolhas.");
  const selections: Array<{ groupId: string; optionIds: string[] }> = [];
  const groupIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const groupId = cleanIdentifier((raw as Record<string, unknown>).groupId);
    const optionIds = normalizeOptionIds((raw as Record<string, unknown>).optionIds);
    if (!groupId || !optionIds.length || groupIds.has(groupId)) continue;
    groupIds.add(groupId);
    selections.push({ groupId, optionIds });
  }
  return selections.sort((a, b) => a.groupId.localeCompare(b.groupId));
}

function normalizeOptionIds(values: unknown) {
  if (!Array.isArray(values)) return [];
  if (values.length > 30) throw new BadRequestException("Um grupo pode ter no máximo 30 opções escolhidas.");
  return [...new Set(values.map(cleanIdentifier).filter((value): value is string => Boolean(value)))].sort();
}

function cleanIdentifier(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.slice(0, 191) || null;
}

function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return normalized || null;
}

function requiredText(value: unknown, message: string, maxLength: number) {
  const normalized = cleanOptionalText(value, maxLength);
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

function normalizeAddress(input: Partial<WhatsAppDeliveryAddress>): WhatsAppDeliveryAddress {
  const state = requiredText(input.state, "Informe a UF com duas letras.", 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new BadRequestException("Informe a UF com duas letras, por exemplo MG.");
  const zipCode = String(input.zipCode ?? "").replace(/\D/g, "");
  if (zipCode.length !== 8) throw new BadRequestException("Informe o CEP com 8 dígitos.");
  return {
    street: requiredText(input.street, "Informe a rua ou avenida.", 191),
    number: requiredText(input.number, "Informe o número do endereço.", 40),
    complement: cleanOptionalText(input.complement, 191),
    neighborhood: requiredText(input.neighborhood, "Informe o bairro.", 191),
    city: requiredText(input.city, "Informe a cidade.", 191),
    state,
    zipCode,
    reference: cleanOptionalText(input.reference, 191),
    latitude: finiteCoordinate(input.latitude),
    longitude: finiteCoordinate(input.longitude),
  };
}

function addressFromDraft(draft: any): WhatsAppDeliveryAddress {
  return normalizeAddress({
    street: draft.addressStreet,
    number: draft.addressNumber,
    complement: draft.addressComplement,
    neighborhood: draft.addressNeighborhood,
    city: draft.addressCity,
    state: draft.addressState,
    zipCode: draft.addressZipCode,
    reference: draft.addressReference,
    latitude: draft.addressLatitude === null || draft.addressLatitude === undefined ? null : Number(draft.addressLatitude),
    longitude: draft.addressLongitude === null || draft.addressLongitude === undefined ? null : Number(draft.addressLongitude),
  });
}

function draftAddressView(draft: any) {
  if (!draft.addressStreet || !draft.addressNumber || !draft.addressNeighborhood || !draft.addressCity || !draft.addressState) return null;
  return {
    street: draft.addressStreet,
    number: draft.addressNumber,
    complement: draft.addressComplement ?? null,
    neighborhood: draft.addressNeighborhood,
    city: draft.addressCity,
    state: draft.addressState,
    zipCode: draft.addressZipCode ?? null,
    reference: draft.addressReference ?? null,
  };
}

function finiteCoordinate(value: unknown) {
  const coordinate = value === null || value === undefined || value === "" ? null : Number(value);
  return coordinate !== null && Number.isFinite(coordinate) ? coordinate : null;
}

function readCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const cart: CartLine[] = [];
  for (const rawLine of value) {
    if (!rawLine || typeof rawLine !== "object") continue;
    const raw = rawLine as Record<string, unknown>;
    const id = cleanIdentifier(raw.id);
    const productId = cleanIdentifier(raw.productId);
    const quantity = Number(raw.quantity);
    if (!id || !productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) continue;
    cart.push({
      id,
      productId,
      quantity,
      variationId: cleanIdentifier(raw.variationId),
      addonIds: normalizeIds(raw.addonIds),
      optionSelections: normalizeOptionSelections(raw.optionSelections),
      notes: cleanOptionalText(raw.notes, 500),
    });
  }
  return cart.slice(0, MAX_CART_LINES);
}

function cartLineKey(line: CartLine) {
  return JSON.stringify({
    productId: line.productId,
    variationId: line.variationId ?? null,
    addonIds: [...line.addonIds].sort(),
    optionSelections: line.optionSelections
      .map((selection) => ({ groupId: selection.groupId, optionIds: [...selection.optionIds].sort() }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId)),
    notes: line.notes ?? null,
  });
}

function activeDraftKey(companyId: string, conversationId: string) {
  return `${companyId}:${conversationId}`;
}

function normalizePaymentMethod(value: unknown) {
  if (!Object.values(PaymentMethod).includes(value as PaymentMethod)) {
    throw new BadRequestException("Escolha uma forma de pagamento aceita pela loja.");
  }
  return value as PaymentMethod;
}

function proposalSnapshot(checkout: PreparedWhatsAppCheckout) {
  return {
    type: "proposal",
    preparedAt: new Date().toISOString(),
    checkout: {
      items: checkout.items.map((item) => ({
        productId: item.productId,
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        variation: item.variationName,
        addons: item.addons,
        optionSelections: item.optionSelections ?? [],
        notes: item.notes,
        totalPrice: item.totalPrice,
      })),
      address: {
        street: checkout.address.street,
        number: checkout.address.number,
        complement: checkout.address.complement ?? null,
        neighborhood: checkout.address.neighborhood,
        city: checkout.address.city,
        state: checkout.address.state,
        zipCode: checkout.address.zipCode ?? null,
        reference: checkout.address.reference ?? null,
      },
      paymentMethod: checkout.paymentMethod,
      subtotal: checkout.subtotal,
      delivery: {
        deliveryFee: checkout.deliveryFee,
        distanceKm: checkout.distanceKm,
        durationMinutes: checkout.durationMinutes,
      },
      total: checkout.total,
    },
  };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function nextSteps(draft: any, cartSize: number) {
  const steps: string[] = [];
  if (!cartSize) steps.push("adicionar itens do cardápio");
  if (!draft.customerName) steps.push("informar o nome do cliente");
  if (!draft.addressStreet || !draft.addressNumber || !draft.addressNeighborhood || !draft.addressCity || !draft.addressState) {
    steps.push("informar o endereço completo para calcular frete");
  }
  if (!draft.paymentMethod) steps.push("escolher a forma de pagamento");
  if (!steps.length && draft.status !== WhatsAppOrderDraftStatus.CONCLUIDO) steps.push("mostrar resumo e pedir CONFIRMAR");
  return steps;
}

function hasExplicitConfirmation(value: string) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[.!]/g, "")
    .replace(/\s+/g, " ");
  return /^(?:SIM,? )?(?:PODE )?(?:CONFIRMAR|CONFIRMO)(?: (?:O )?(?:PEDIDO|COMPRA))?$/.test(normalized);
}

function orderResult(order: any, created: boolean) {
  return {
    confirmed: true,
    created,
    message: created
      ? "Pedido criado e enviado para a equipe e cozinha. Confirme ao cliente o número, total e prazo estimado."
      : "Esse pedido já tinha sido criado; não gere outro. Confirme os mesmos dados ao cliente.",
    order: {
      id: order.id,
      shortCode: order.id.slice(-6).toUpperCase(),
      status: order.status,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.deliveryFee),
      distanceKm: order.deliveryDistanceKm === null || order.deliveryDistanceKm === undefined ? null : Number(order.deliveryDistanceKm),
      durationMinutes: order.deliveryRouteDurationMinutes ?? null,
      total: Number(order.total),
      paymentMethod: order.paymentMethod,
      items: (order.items ?? []).map((item: any) => ({
        name: item.productName,
        quantity: item.quantity,
        totalPrice: Number(item.totalPrice),
      })),
    },
  };
}

function publicErrorMessage(error: unknown) {
  if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) {
    const response = error.getResponse();
    if (typeof response === "string") return response;
    if (response && typeof response === "object" && "message" in response) {
      const message = (response as { message?: unknown }).message;
      return Array.isArray(message) ? message.join(" ") : String(message ?? "Não foi possível concluir agora.");
    }
  }
  return "Não foi possível concluir agora. Revise os dados ou tente novamente.";
}

function isUniqueConstraint(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}
