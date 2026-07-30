// Fonte única desses enums: os valores aqui DEVEM ser idênticos aos enums do
// apps/api/prisma/schema.prisma (não há forma de o Prisma importar TS enums no
// schema, então mantemos os dois em sincronia manualmente).

export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  FUNCIONARIO = "FUNCIONARIO",
  COZINHA = "COZINHA",
  MOTOBOY = "MOTOBOY",
  CLIENTE = "CLIENTE",
}

export enum OrderStatus {
  RECEBIDO = "RECEBIDO",
  CONFIRMADO = "CONFIRMADO",
  EM_PREPARO = "EM_PREPARO",
  PRONTO = "PRONTO",
  SAIU_PARA_ENTREGA = "SAIU_PARA_ENTREGA",
  ENTREGUE = "ENTREGUE",
  CANCELADO = "CANCELADO",
}

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  OrderStatus.RECEBIDO,
  OrderStatus.CONFIRMADO,
  OrderStatus.EM_PREPARO,
  OrderStatus.PRONTO,
  OrderStatus.SAIU_PARA_ENTREGA,
  OrderStatus.ENTREGUE,
];

export enum DeliveryStatus {
  AGUARDANDO_RETIRADA = "AGUARDANDO_RETIRADA",
  RETIRADO = "RETIRADO",
  EM_ROTA = "EM_ROTA",
  ENTREGUE = "ENTREGUE",
  PROBLEMA = "PROBLEMA",
}

export enum PaymentMethod {
  DINHEIRO = "DINHEIRO",
  CARTAO_ENTREGA = "CARTAO_ENTREGA",
  PIX_MANUAL = "PIX_MANUAL",
}

export enum PaymentStatus {
  PENDENTE = "PENDENTE",
  PAGO = "PAGO",
  CANCELADO = "CANCELADO",
}

export enum PromotionStatus {
  RASCUNHO = "RASCUNHO",
  PENDENTE_CONFIRMACAO = "PENDENTE_CONFIRMACAO",
  ATIVA = "ATIVA",
  ENCERRADA = "ENCERRADA",
}

export enum PermissionKey {
  PEDIDOS_VISUALIZAR = "pedidos.visualizar",
  PEDIDOS_EDITAR = "pedidos.editar",
  PEDIDOS_CANCELAR = "pedidos.cancelar",
  CARDAPIO_VISUALIZAR = "cardapio.visualizar",
  CARDAPIO_EDITAR = "cardapio.editar",
  ENTREGAS_VISUALIZAR = "entregas.visualizar",
  ENTREGAS_EDITAR = "entregas.editar",
  FUNCIONARIOS_VISUALIZAR = "funcionarios.visualizar",
  FUNCIONARIOS_EDITAR = "funcionarios.editar",
  RELATORIOS_VISUALIZAR = "relatorios.visualizar",
  CONFIGURACOES_EDITAR = "configuracoes.editar",
}

export enum AIAgentRole {
  OPERACIONAL = "OPERACIONAL",
  ATENDIMENTO = "ATENDIMENTO",
  ONBOARDING = "ONBOARDING",
}

export enum AIChannel {
  INTERNO = "INTERNO",
  CLIENTE = "CLIENTE",
}

export enum MessagingChannelType {
  WHATSAPP = "WHATSAPP",
}
