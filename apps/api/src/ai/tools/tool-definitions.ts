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
      "Cria um RASCUNHO de promoção pendente de confirmação humana. Nunca ativa a promoção sozinho — sempre pede confirmação explícita do ADMIN antes de ativar. A promoção é apenas divulgação: o carrinho NÃO abate o valor automaticamente, o desconto é concedido pela loja no atendimento. Deixe isso claro ao confirmar com o lojista.",
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
      "Busca semanticamente produtos ativos do cardápio público por nome, descrição, categoria, ingrediente ou faixa de preço. Aceita linguagem natural e sinônimos (ex.: sanduíche, lanche, hambúrguer e smash). Use sempre antes de responder dúvidas sobre itens.",
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

/**
 * Ferramentas adicionais do atendimento pelo WhatsApp Cloud API. Elas não são
 * entregues ao agente da loja pública: o cliente do WhatsApp não tem login e
 * cada chamada é amarrada no servidor à conversa/número que a originou.
 */
export const WHATSAPP_ORDER_TOOLS: AIToolDefinition[] = [
  {
    name: "getWhatsAppOrderDraft",
    description:
      "Mostra o carrinho persistente desta conversa, os dados que já foram coletados, a estimativa de rota/frete e o próximo dado necessário. Use para retomar um pedido sem inventar valores.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "updateWhatsAppCart",
    description:
      "Altera o carrinho persistente desta conversa. Use somente IDs retornados por searchCatalog. Nunca informe preço manualmente: o servidor resolve preço, variação, adicionais e regras de grupos configuráveis da empresa.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["ADD", "SET", "REMOVE", "CLEAR"], description: "ADD adiciona, SET altera quantidade, REMOVE remove uma linha e CLEAR esvazia o carrinho." },
        lineId: { type: "string", description: "Identificador da linha retornado por getWhatsAppOrderDraft; obrigatório para SET e REMOVE." },
        productId: { type: "string", description: "ID do produto retornado por searchCatalog; obrigatório para ADD." },
        quantity: { type: "integer", minimum: 1, maximum: 99, description: "Quantidade; obrigatória para ADD e SET." },
        variationId: { type: "string", description: "ID da variação retornada por searchCatalog, se o cliente escolheu uma." },
        addonIds: { type: "array", items: { type: "string" }, description: "IDs dos adicionais retornados por searchCatalog." },
        optionSelections: {
          type: "array",
          description: "Escolhas de grupos configuráveis, como tamanho e sabores. Informe apenas IDs retornados por searchCatalog.",
          items: {
            type: "object",
            properties: {
              groupId: { type: "string" },
              optionIds: { type: "array", items: { type: "string" } },
            },
            required: ["groupId", "optionIds"],
            additionalProperties: false,
          },
        },
        notes: { type: "string", description: "Observação do item, como retirar cebola." },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
  {
    name: "setWhatsAppCustomerName",
    description: "Registra o nome que o cliente informou para este pedido pelo WhatsApp.",
    parameters: {
      type: "object",
      properties: { customerName: { type: "string" } },
      required: ["customerName"],
      additionalProperties: false,
    },
  },
  {
    name: "setWhatsAppDeliveryAddress",
    description:
      "Registra endereço completo e calcula imediatamente a rota e o frete reais. Só chame depois que o cliente informar rua, número, bairro, cidade e UF; não invente campos faltantes.",
    parameters: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "Nome do cliente, caso ele o informe junto do endereço." },
        street: { type: "string" },
        number: { type: "string" },
        complement: { type: "string" },
        neighborhood: { type: "string" },
        city: { type: "string" },
        state: { type: "string", description: "UF com duas letras, por exemplo MG." },
        zipCode: { type: "string", description: "CEP, se informado." },
        reference: { type: "string" },
      },
      required: ["street", "number", "neighborhood", "city", "state"],
      additionalProperties: false,
    },
  },
  {
    name: "setWhatsAppPaymentMethod",
    description: "Registra a forma de pagamento escolhida. Só ofereça opções retornadas por getStoreInfo.",
    parameters: {
      type: "object",
      properties: { paymentMethod: { type: "string", enum: ["DINHEIRO", "CARTAO_ENTREGA", "PIX_MANUAL"] } },
      required: ["paymentMethod"],
      additionalProperties: false,
    },
  },
  {
    name: "setWhatsAppOrderNotes",
    description: "Registra uma observação geral do pedido, se o cliente pedir.",
    parameters: {
      type: "object",
      properties: { notes: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "prepareWhatsAppOrderConfirmation",
    description:
      "Calcula e congela um resumo atualizado com itens, rota, frete e total. Chame somente depois de ter itens, nome, endereço e pagamento. Após o resultado, peça a palavra exata CONFIRMAR e não crie o pedido ainda.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "confirmWhatsAppOrder",
    description:
      "Tenta criar o pedido somente quando a mensagem atual do cliente contiver confirmação explícita (CONFIRMAR, CONFIRMO ou PODE CONFIRMAR) e um resumo vigente já tiver sido apresentado. Nunca chame apenas porque o cliente disse oi, sim genérico ou pediu orçamento.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];
