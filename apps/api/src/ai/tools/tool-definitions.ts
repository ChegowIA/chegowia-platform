import { AIToolDefinition } from "../providers/ai-provider.interface";

/**
 * Definições JSON Schema das ferramentas que o agente OPERACIONAL pode chamar.
 * O agente NUNCA tem acesso livre ao banco — só estas funções, executadas pelo
 * ToolsService, que sempre re-resolve o companyId a partir da conversa (nunca do
 * argumento que o modelo eventualmente inventar).
 */
export const OPERATIONAL_TOOLS: AIToolDefinition[] = [
  {
    name: "getTodayOrders",
    description: "Lista os pedidos recebidos hoje pela empresa, com status e valores.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getDelayedOrders",
    description: "Lista pedidos parados há mais tempo que o esperado em um status não-final.",
    parameters: {
      type: "object",
      properties: {
        thresholdMinutes: { type: "number", description: "Minutos parados para considerar atraso. Padrão 30." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getTopProducts",
    description: "Retorna os produtos mais vendidos em um período.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["today", "week", "month"], description: "Período de análise." },
      },
      required: ["period"],
      additionalProperties: false,
    },
  },
  {
    name: "getPendingDeliveries",
    description: "Lista entregas pendentes (ainda não concluídas), com motoboy atribuído se houver.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "getInactiveCustomers",
    description: "Lista clientes que não compram há N dias — útil para campanhas de reativação.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Quantidade de dias de inatividade. Padrão 30." } },
      additionalProperties: false,
    },
  },
  {
    name: "createPromotionDraft",
    description:
      "Cria um RASCUNHO de promoção pendente de confirmação humana. Nunca ativa a promoção sozinho — sempre pede confirmação explícita do ADMIN antes de ativar.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        discountType: { type: "string", enum: ["PERCENTUAL", "VALOR_FIXO"] },
        discountValue: { type: "number" },
      },
      required: ["title", "discountType", "discountValue"],
      additionalProperties: false,
    },
  },
  {
    name: "generateProductDescription",
    description: "Gera uma sugestão de descrição de venda mais atrativa para um produto do cardápio.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        currentDescription: { type: "string" },
        ingredients: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

export const ONBOARDING_TOOLS: AIToolDefinition[] = [
  OPERATIONAL_TOOLS.find((t) => t.name === "generateProductDescription")!,
];

export const ATENDIMENTO_TOOLS: AIToolDefinition[] = [
  {
    name: "searchCatalog",
    description:
      "Busca produtos ativos do cardápio público da empresa atual por nome, descrição, categoria ou faixa de preço. Use sempre antes de responder dúvidas sobre itens específicos.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Produto, categoria ou ingrediente buscado pelo cliente." },
        category: { type: "string", description: "Categoria desejada, quando o cliente informar." },
        maxPrice: { type: "number", description: "Preço máximo em reais, quando o cliente informar." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getStoreInfo",
    description:
      "Retorna dados públicos da loja atual: endereço, cidade, taxa de entrega, tempo médio, WhatsApp, bairros atendidos e formas de pagamento cadastradas.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
