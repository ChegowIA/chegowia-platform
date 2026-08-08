import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PromotionStatus } from "@prisma/client";
import { PRISMA_CLIENT } from "../../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../../common/prisma/prisma-client.factory";
import { tenantContext } from "../../common/tenant/tenant-context";
import { AI_PROVIDER, AIProvider } from "../providers/ai-provider.interface";
import { UsageService } from "../../usage/usage.service";
import { WhatsAppOrdersService } from "../../orders/whatsapp-orders.service";

/**
 * Implementação das ferramentas listadas em tool-definitions.ts. Cada método recebe
 * o companyId explicitamente (resolvido pelo AiService a partir da conversa real —
 * NUNCA a partir do argumento que o modelo de IA eventualmente produzir) e roda a
 * query dentro de `tenantContext.runAsCompany`, então mesmo tools chamadas fora de um
 * request HTTP autenticado (ex.: fluxo de atendimento público) continuam isoladas
 * por empresa. Esta é a única superfície de acesso a dados que o agente tem —
 * ele nunca executa SQL/Prisma livre.
 */
@Injectable()
export class ToolsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly usage: UsageService,
    private readonly whatsappOrders?: WhatsAppOrdersService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  private scoped<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.runAsCompany(companyId, fn);
  }

  async getTodayOrders(companyId: string) {
    return this.scoped(companyId, async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const orders = await this.db().order.findMany({
        where: { createdAt: { gte: start } },
        select: {
          id: true,
          status: true,
          total: true,
          createdAt: true,
          customerName: true,
          customerPhone: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        count: orders.length,
        totalRevenue: orders.reduce((sum: number, o: any) => sum + Number(o.total), 0),
        orders,
      };
    });
  }

  async getDelayedOrders(companyId: string, thresholdMinutes = 30) {
    return this.scoped(companyId, async () => {
      const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
      return this.db().order.findMany({
        where: { status: { notIn: ["ENTREGUE", "CANCELADO"] }, updatedAt: { lt: threshold } },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          customerName: true,
          customerPhone: true,
          customer: { select: { name: true } },
        },
        orderBy: { updatedAt: "asc" },
      });
    });
  }

  async getTopProducts(companyId: string, period: "today" | "week" | "month") {
    return this.scoped(companyId, async () => {
      const since = new Date();
      if (period === "today") since.setHours(0, 0, 0, 0);
      else if (period === "week") since.setDate(since.getDate() - 7);
      else since.setMonth(since.getMonth() - 1);

      const grouped = await this.db().orderItem.groupBy({
        by: ["productId", "productName"],
        // companyId explícito: OrderItem não está no TENANT_MODELS e a extensão
        // do Prisma não reescreve filtro de relação — sem isto o agrupamento
        // cruza todas as empresas da plataforma.
        where: { order: { companyId, createdAt: { gte: since }, status: { not: "CANCELADO" } } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      });

      return grouped.map((g: any) => ({
        productId: g.productId,
        productName: g.productName,
        quantitySold: g._sum.quantity ?? 0,
        revenue: Number(g._sum.totalPrice ?? 0),
      }));
    });
  }

  async getPendingDeliveries(companyId: string) {
    return this.scoped(companyId, async () =>
      this.db().delivery.findMany({
        where: { status: { not: "ENTREGUE" } },
        select: {
          id: true,
          status: true,
          motoboy: { select: { name: true } },
          order: { select: { id: true, deliveryNeighborhood: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
  }

  async getInactiveCustomers(companyId: string, days = 30) {
    return this.scoped(companyId, async () => {
      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      return this.db().customerProfile.findMany({
        where: { OR: [{ lastOrderAt: { lt: threshold } }, { lastOrderAt: null, createdAt: { lt: threshold } }] },
        select: { totalOrders: true, lastOrderAt: true, user: { select: { name: true, email: true } } },
        orderBy: { lastOrderAt: "asc" },
      });
    });
  }

  /** Ação sensível: cria um RASCUNHO — ativar exige confirmação humana via AiService.confirmAction. */
  async createPromotionDraft(
    companyId: string,
    data: { title: string; description?: string; discountType: string; discountValue: number },
  ) {
    if (!["PERCENTUAL", "VALOR_FIXO"].includes(data.discountType)) {
      throw new BadRequestException("Tipo de desconto inválido.");
    }
    return this.scoped(companyId, () =>
      this.db().promotion.create({
        data: {
          title: data.title,
          description: data.description,
          discountType: data.discountType,
          discountValue: data.discountValue,
          status: PromotionStatus.PENDENTE_CONFIRMACAO,
          createdByAI: true,
        },
      }),
    );
  }

  /**
   * Gera a descrição de um produto.
   *
   * Recebe `companyId` porque esta ferramenta faz uma **segunda** chamada à IA,
   * separada da conversa que a invocou. Sem registrar o consumo, quanto mais o
   * lojista usasse o recurso, mais a plataforma pagaria sem cobrar — e o
   * gasto não aparecia na conta dele.
   */
  async generateProductDescription(
    companyId: string,
    data: { name: string; currentDescription?: string; ingredients?: string },
  ) {
    const result = await this.aiProvider.chat([
      {
        role: "system",
        content:
          "Você escreve descrições curtas (até 40 palavras), apetitosas e vendedoras para itens de cardápio de delivery, em português do Brasil. Responda só com a descrição, sem aspas.",
      },
      {
        role: "user",
        content: `Produto: ${data.name}\nDescrição atual: ${data.currentDescription ?? "(nenhuma)"}\nIngredientes: ${data.ingredients ?? "(não informado)"}`,
      },
    ]);
    if (result.usage) {
      await this.usage.recordAiUsage({
        companyId,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        uncachedInputTokens: result.usage.uncachedInputTokens,
        outputTokens: result.usage.outputTokens,
        requestId: result.requestId,
      });
    }
    return { description: result.content?.trim() ?? "" };
  }

  async searchCatalog(
    companyId: string,
    data: { query?: string; category?: string; maxPrice?: number } = {},
  ) {
    return this.scoped(companyId, async () => {
      const where: any = { isActive: true };
      const query = data.query?.trim();
      const category = data.category?.trim();

      if (query) {
        const queryTokens = searchTokens(query);
        if (queryTokens.length) where.OR = buildStoreProductSearch(queryTokens);
      }
      if (category) {
        const categoryTokens = searchTokens(category);
        if (categoryTokens.length) {
          where.AND = [
            {
              OR: categoryTokens.flatMap((token) => [
                { category: { is: { name: { contains: token } } } },
                { name: { contains: token } },
                { description: { contains: token } },
              ]),
            },
          ];
        }
      }
      if (typeof data.maxPrice === "number") {
        where.price = { lte: data.maxPrice };
      }

      const products = await this.db().product.findMany({
        where,
        take: 12,
        orderBy: [{ isFeatured: "desc" }, { name: "asc" }],
        include: { category: true, variations: { where: { isActive: true } }, addons: { where: { isActive: true } } },
      });

      return products.map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        imageUrl: product.imageUrl,
        isFeatured: product.isFeatured,
        category: product.category?.name,
        variations: product.variations.map((variation: any) => ({
          id: variation.id,
          name: variation.name,
          priceDelta: Number(variation.priceDelta),
        })),
        addons: product.addons.map((addon: any) => ({ id: addon.id, name: addon.name, price: Number(addon.price) })),
      }));
    });
  }

  async getStoreInfo(companyId: string) {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      include: {
        deliveryAreas: { where: { isActive: true }, select: { neighborhood: true, city: true, deliveryFee: true } },
        settings: { select: { openingHours: true, paymentMethodsEnabled: true, whatsappNumber: true } },
      },
    });

    return company
      ? {
          name: company.name,
          addressLine: company.addressLine,
          city: company.city,
          state: company.state,
          whatsapp: company.settings?.whatsappNumber ?? company.whatsapp,
          deliveryFeeBase: Number(company.deliveryFeeBase),
          avgDeliveryTimeMinutes: company.avgDeliveryTimeMinutes,
          deliveryAreas: company.deliveryAreas.map((area: any) => ({
            neighborhood: area.neighborhood,
            city: area.city,
            deliveryFee: area.deliveryFee === null ? null : Number(area.deliveryFee),
          })),
          openingHours: company.settings?.openingHours,
          paymentMethodsEnabled: company.settings?.paymentMethodsEnabled,
        }
      : null;
  }

  async getWhatsAppOrderDraft(companyId: string, aiConversationId: string) {
    return this.whatsappOrderService().getDraft(companyId, aiConversationId);
  }

  async updateWhatsAppCart(companyId: string, aiConversationId: string, data: any) {
    return this.whatsappOrderService().updateCart(companyId, aiConversationId, data);
  }

  async setWhatsAppCustomerName(companyId: string, aiConversationId: string, data: any) {
    return this.whatsappOrderService().setCustomerName(companyId, aiConversationId, data);
  }

  async setWhatsAppDeliveryAddress(companyId: string, aiConversationId: string, data: any) {
    return this.whatsappOrderService().setDeliveryAddress(companyId, aiConversationId, data);
  }

  async setWhatsAppPaymentMethod(companyId: string, aiConversationId: string, data: any) {
    return this.whatsappOrderService().setPaymentMethod(companyId, aiConversationId, data);
  }

  async setWhatsAppOrderNotes(companyId: string, aiConversationId: string, data: any) {
    return this.whatsappOrderService().setOrderNotes(companyId, aiConversationId, data);
  }

  async prepareWhatsAppOrderConfirmation(companyId: string, aiConversationId: string) {
    return this.whatsappOrderService().prepareConfirmation(companyId, aiConversationId);
  }

  async confirmWhatsAppOrder(companyId: string, aiConversationId: string, customerMessage: string) {
    return this.whatsappOrderService().confirmOrder(companyId, aiConversationId, customerMessage);
  }

  private whatsappOrderService() {
    if (!this.whatsappOrders) {
      throw new BadRequestException("O checkout pelo WhatsApp não está disponível neste ambiente.");
    }
    return this.whatsappOrders;
  }

  /**
   * `terms` chega preenchido quando a busca já passou pela interpretação por IA
   * (ver ai/search/search-intent.service.ts). Sem ele, vale a expansão por
   * sinônimos local — é o que mantém a tool utilizável sem provedor de IA.
   */
  async searchPublicCatalog(data: { message: string; city?: string; neighborhood?: string; terms?: string[] }) {
    const query = data.message.trim();
    const city = data.city?.trim();
    const neighborhood = data.neighborhood?.trim();
    const tokens = data.terms?.length ? data.terms : searchTokens(query);

    const companyWhere: any = { isActive: true };
    if (city) companyWhere.city = { contains: city };
    const companySearch = buildCompanySearch(tokens);
    if (companySearch.length) companyWhere.OR = companySearch;

    const productCompanyWhere: any = { isActive: true };
    if (city) productCompanyWhere.city = { contains: city };
    const productWhere: any = { isActive: true, company: { is: productCompanyWhere } };
    const productSearch = buildProductSearch(tokens);
    if (productSearch.length) productWhere.OR = productSearch;

    const [products, companies] = await Promise.all([
      this.db().product.findMany({
        where: productWhere,
        take: 18,
        orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
        include: {
          category: true,
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
              city: true,
              state: true,
              logoUrl: true,
              deliveryFeeBase: true,
              avgDeliveryTimeMinutes: true,
            },
          },
        },
      }),
      this.db().company.findMany({
        where: companyWhere,
        take: 12,
        orderBy: { name: "asc" },
        include: {
          deliveryAreas: { where: { isActive: true }, select: { neighborhood: true } },
          products: {
            where: { isActive: true },
            take: 3,
            orderBy: [{ isFeatured: "desc" }, { updatedAt: "desc" }],
            select: { id: true, name: true, price: true, imageUrl: true, isFeatured: true },
          },
        },
      }),
    ]);

    const normalizedProducts = products.map((product: any) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      isFeatured: product.isFeatured,
      categoryName: product.category?.name,
      company: {
        id: product.company.id,
        name: product.company.name,
        slug: product.company.slug,
        city: product.company.city,
        state: product.company.state,
        logoUrl: product.company.logoUrl,
        deliveryFeeBase: Number(product.company.deliveryFeeBase),
        avgDeliveryTimeMinutes: product.company.avgDeliveryTimeMinutes,
      },
    }));

    const normalizedCompanies = companies.map((company: any) => ({
      id: company.id,
      name: company.name,
      slug: company.slug,
      city: company.city,
      state: company.state,
      logoUrl: company.logoUrl,
      deliveryFeeBase: Number(company.deliveryFeeBase),
      avgDeliveryTimeMinutes: company.avgDeliveryTimeMinutes,
      deliveryAreas: company.deliveryAreas.map((area: any) => area.neighborhood),
      featuredProducts: company.products.map((product: any) => ({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        imageUrl: product.imageUrl,
        isFeatured: product.isFeatured,
      })),
    }));

    return {
      summary: buildPublicSearchSummary(normalizedProducts.length, normalizedCompanies.length, city, neighborhood),
      query,
      city: city || null,
      neighborhood: neighborhood || null,
      suggestions: buildPublicSearchSuggestions(normalizedProducts.length, normalizedCompanies.length, city),
      products: normalizedProducts,
      companies: normalizedCompanies,
    };
  }
}

const STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "um",
  "uma",
  "uns",
  "umas",
  "por",
  "pra",
  "para",
  "perto",
  "perto de",
  "quero",
  "queria",
  "buscar",
  "procuro",
  "produto",
  "produtos",
  "loja",
  "lojas",
  "empresa",
  "empresas",
  "restaurante",
  "restaurantes",
  "delivery",
]);

function searchTokens(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  const directTokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  const expanded = [...directTokens];

  for (const group of SEARCH_SYNONYM_GROUPS) {
    if (group.some((term) => normalized.includes(term) || directTokens.includes(term))) {
      expanded.push(...group);
    }
  }

  return Array.from(new Set(expanded)).slice(0, 24);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_SYNONYM_GROUPS = [
  ["sanduiche", "lanche", "hamburguer", "hamburger", "burger", "burguer", "smash", "xsalada", "xbacon", "hotdog"],
  ["pizza", "pizzaria", "esfiha", "esfirra", "calzone"],
  ["almoco", "refeicao", "prato", "marmita", "marmitex", "caseira", "executivo"],
  ["sobremesa", "doce", "acai", "sorvete", "milkshake", "bolo", "pudim"],
  ["bebida", "refrigerante", "refri", "suco", "agua", "cerveja"],
  ["japonesa", "japones", "sushi", "sashimi", "temaki", "yakisoba"],
  ["saudavel", "fitness", "fit", "salada", "vegetariano", "vegano"],
  ["massa", "macarrao", "lasanha", "nhoque", "italiana"],
  ["frango", "galeto", "ave"],
  ["carne", "bife", "churrasco", "churrascaria", "costela"],
] as const;

function buildStoreProductSearch(tokens: string[]) {
  return tokens.flatMap((token) => [
    { name: { contains: token } },
    { description: { contains: token } },
    { category: { is: { name: { contains: token } } } },
  ]);
}

function buildProductSearch(tokens: string[]) {
  return tokens.flatMap((token) => [
    { name: { contains: token } },
    { description: { contains: token } },
    { category: { is: { name: { contains: token } } } },
  ]);
}

function buildCompanySearch(tokens: string[]) {
  return tokens.flatMap((token) => [
    { name: { contains: token } },
    { city: { contains: token } },
    { state: { contains: token } },
    { deliveryAreas: { some: { neighborhood: { contains: token }, isActive: true } } },
    { products: { some: { isActive: true, name: { contains: token } } } },
    { products: { some: { isActive: true, description: { contains: token } } } },
  ]);
}

function buildPublicSearchSummary(productCount: number, companyCount: number, city?: string, neighborhood?: string) {
  const region = city || neighborhood;
  if (productCount || companyCount) {
    return `Encontrei ${productCount} produto${productCount === 1 ? "" : "s"} e ${companyCount} loja${
      companyCount === 1 ? "" : "s"
    }${region ? ` para ${region}` : ""}.`;
  }
  return region
    ? `Ainda não encontrei produtos ou lojas para ${region}. Tente uma cidade próxima ou um termo mais amplo.`
    : "Ainda não encontrei produtos ou lojas para essa busca. Tente informar produto, cidade ou bairro.";
}

function buildPublicSearchSuggestions(productCount: number, companyCount: number, city?: string) {
  if (productCount || companyCount) {
    return [
      "Abra uma loja para ver o cardápio completo.",
      "Descreva sua vontade, ingrediente ou faixa de preço para refinar.",
      "Compare taxa, tempo médio e preço antes de adicionar ao carrinho.",
    ];
  }
  return [
    city ? "Tente descrever a sua vontade, como “algo doce” ou “um lanche com carne”." : "Cadastre sua cidade para localizar empresas próximas.",
    "Você pode buscar com linguagem natural: pizza, lanche, almoço, sushi ou sobremesa.",
    "Confira se a empresa já está ativa no painel administrativo.",
  ];
}
