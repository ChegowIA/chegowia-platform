/** Definição única da ChegowIA; a aprovação e o ID continuam sendo por WABA. */
export const ORDER_UPDATE_TEMPLATE = {
  name: "chegowia_atualizacao_pedido_v1",
  languageCode: "pt_BR",
  body: "Olá {{1}}! Seu pedido #{{2}} em {{3}} está {{4}}. Se precisar de ajuda, responda esta mensagem.",
  example: "Olá Ana! Seu pedido #ABC123 em Pizzaria Exemplo está a caminho da entrega. Se precisar de ajuda, responda esta mensagem.",
} as const;
