// Fonte única desses enums: os valores aqui DEVEM ser idênticos aos enums do
// apps/api/prisma/schema.prisma (não há forma de o Prisma importar TS enums no
// schema, então mantemos os dois em sincronia manualmente).
//
// A cobertura é TOTAL: todos os enums do schema estão espelhados aqui, na mesma
// ordem, para que a paridade possa ser conferida num diff lado a lado. Ao criar
// um enum novo no schema, replique-o aqui. `PermissionKey` e `ORDER_STATUS_FLOW`
// são as únicas exceções deliberadas — não existem no Prisma (ver comentários).

export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  FUNCIONARIO = "FUNCIONARIO",
  COZINHA = "COZINHA",
  MOTOBOY = "MOTOBOY",
  GARCOM = "GARCOM",
  CLIENTE = "CLIENTE",
  REVENDEDOR = "REVENDEDOR",
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

export enum DeliveryProblemReason {
  CLIENTE_NAO_ATENDEU = "CLIENTE_NAO_ATENDEU",
  ENDERECO_NAO_LOCALIZADO = "ENDERECO_NAO_LOCALIZADO",
  CLIENTE_RECUSOU = "CLIENTE_RECUSOU",
  VEICULO_COM_PROBLEMA = "VEICULO_COM_PROBLEMA",
  PEDIDO_DANIFICADO = "PEDIDO_DANIFICADO",
  AREA_DE_RISCO = "AREA_DE_RISCO",
  OUTRO = "OUTRO",
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

export enum OrderSource {
  SITE = "SITE",
  WHATSAPP = "WHATSAPP",
}

export enum OrderFulfillmentType {
  DELIVERY = "DELIVERY",
  PICKUP = "PICKUP",
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
  MESAS_VISUALIZAR = "mesas.visualizar",
  MESAS_OPERAR = "mesas.operar",
  CARDAPIO_VISUALIZAR = "cardapio.visualizar",
  CARDAPIO_EDITAR = "cardapio.editar",
  ENTREGAS_VISUALIZAR = "entregas.visualizar",
  ENTREGAS_EDITAR = "entregas.editar",
  FUNCIONARIOS_VISUALIZAR = "funcionarios.visualizar",
  FUNCIONARIOS_EDITAR = "funcionarios.editar",
  RELATORIOS_VISUALIZAR = "relatorios.visualizar",
  CONFIGURACOES_EDITAR = "configuracoes.editar",
  FISCAL_VISUALIZAR = "fiscal.visualizar",
  FISCAL_CONFIGURAR = "fiscal.configurar",
  CAIXA_VISUALIZAR = "caixa.visualizar",
  CAIXA_OPERAR = "caixa.operar",
  CAIXA_GERENCIAR = "caixa.gerenciar",
  /**
   * Atendimento por WhatsApp.
   *
   * Era amarrado às permissões de pedido: quem podia ver pedido lia todas as
   * conversas dos clientes — telefone, endereço, o que a pessoa escreveu — e não
   * havia como dar o inbox a um atendente sem dar pedidos junto. São coisas
   * diferentes e passaram a ter permissão própria.
   */
  ATENDIMENTO_VISUALIZAR = "atendimento.visualizar",
  ATENDIMENTO_RESPONDER = "atendimento.responder",
}

// Regime tributário — decide CSOSN (Simples) ou CST (normal) no cálculo.
export enum TaxRegime {
  SIMPLES_NACIONAL = "SIMPLES_NACIONAL",
  SIMPLES_NACIONAL_EXCESSO = "SIMPLES_NACIONAL_EXCESSO",
  REGIME_NORMAL = "REGIME_NORMAL",
}

export enum FiscalEnvironment {
  HOMOLOGACAO = "HOMOLOGACAO",
  PRODUCAO = "PRODUCAO",
}

export enum FiscalDocumentStatus {
  RASCUNHO = "RASCUNHO",
  ASSINADA = "ASSINADA",
  ENVIANDO = "ENVIANDO",
  AUTORIZADA = "AUTORIZADA",
  REJEITADA = "REJEITADA",
  DENEGADA = "DENEGADA",
  CANCELADA = "CANCELADA",
  CONTINGENCIA = "CONTINGENCIA",
  INUTILIZADA = "INUTILIZADA",
}

export enum FiscalEmissionType {
  NORMAL = "NORMAL",
  CONTINGENCIA_OFFLINE = "CONTINGENCIA_OFFLINE",
}

export enum CashSessionStatus {
  ABERTO = "ABERTO",
  FECHADO = "FECHADO",
}

export enum CashMovementType {
  SANGRIA = "SANGRIA",
  SUPRIMENTO = "SUPRIMENTO",
  AJUSTE = "AJUSTE",
}

export enum FiscalCertificateStatus {
  ATIVO = "ATIVO",
  SUBSTITUIDO = "SUBSTITUIDO",
  REVOGADO = "REVOGADO",
}

export enum AIAgentRole {
  OPERACIONAL = "OPERACIONAL",
  ATENDIMENTO = "ATENDIMENTO",
  ONBOARDING = "ONBOARDING",
}

export enum AIChannel {
  INTERNO = "INTERNO",
  CLIENTE = "CLIENTE",
  WHATSAPP = "WHATSAPP",
}

export enum AIMessageRole {
  SYSTEM = "SYSTEM",
  USER = "USER",
  ASSISTANT = "ASSISTANT",
  TOOL = "TOOL",
}

export enum MessagingChannelType {
  WHATSAPP = "WHATSAPP",
}

export enum MessagingChannelStatus {
  ATIVO = "ATIVO",
  INATIVO = "INATIVO",
}

export enum WhatsAppConversationMode {
  VIRTUAL = "VIRTUAL",
  HUMANO = "HUMANO",
}

export enum WhatsAppConversationStatus {
  ABERTA = "ABERTA",
  ENCERRADA = "ENCERRADA",
}

export enum WhatsAppMessageDirection {
  RECEBIDA = "RECEBIDA",
  ENVIADA = "ENVIADA",
}

export enum WhatsAppMessageStatus {
  RECEBIDA = "RECEBIDA",
  ENVIADA = "ENVIADA",
  ENTREGUE = "ENTREGUE",
  LIDA = "LIDA",
  FALHOU = "FALHOU",
}

export enum PlatformSupportConversationMode {
  IA = "IA",
  HUMANO = "HUMANO",
}

export enum PlatformSupportConversationStatus {
  ABERTA = "ABERTA",
  ENCERRADA = "ENCERRADA",
}

export enum PlatformSupportMessageRole {
  USUARIO = "USUARIO",
  ASSISTENTE = "ASSISTENTE",
  SUPER_ADMIN = "SUPER_ADMIN",
  SISTEMA = "SISTEMA",
}

export enum WhatsAppOrderDraftStatus {
  MONTANDO = "MONTANDO",
  AGUARDANDO_CONFIRMACAO = "AGUARDANDO_CONFIRMACAO",
  CONCLUIDO = "CONCLUIDO",
  CANCELADO = "CANCELADO",
}

export enum UsageSource {
  IA = "IA",
  WHATSAPP = "WHATSAPP",
}

export enum UsageMetric {
  IA_TOKENS_ENTRADA = "IA_TOKENS_ENTRADA",
  IA_TOKENS_ENTRADA_CACHE = "IA_TOKENS_ENTRADA_CACHE",
  IA_TOKENS_SAIDA = "IA_TOKENS_SAIDA",
  WHATSAPP_SERVICO = "WHATSAPP_SERVICO",
  WHATSAPP_TEMPLATE_UTILIDADE = "WHATSAPP_TEMPLATE_UTILIDADE",
  WHATSAPP_TEMPLATE_MARKETING = "WHATSAPP_TEMPLATE_MARKETING",
  WHATSAPP_TEMPLATE_AUTENTICACAO = "WHATSAPP_TEMPLATE_AUTENTICACAO",
}

export enum UsageLedgerStatus {
  PENDENTE = "PENDENTE",
  SINCRONIZADO = "SINCRONIZADO",
  FATURADO = "FATURADO",
  FALHOU = "FALHOU",
}

export enum ProductOptionSelectionType {
  SINGLE = "SINGLE",
  MULTIPLE = "MULTIPLE",
}

export enum ProductOptionPricingRule {
  SUM = "SUM",
  HIGHEST = "HIGHEST",
  AVERAGE = "AVERAGE",
}

export enum TableStatus {
  LIVRE = "LIVRE",
  OCUPADA = "OCUPADA",
  RESERVADA = "RESERVADA",
  INATIVA = "INATIVA",
}

export enum TableSessionStatus {
  ABERTA = "ABERTA",
  FECHADA = "FECHADA",
  CANCELADA = "CANCELADA",
}

export enum DiningOrderStatus {
  RECEBIDO = "RECEBIDO",
  EM_PREPARO = "EM_PREPARO",
  PRONTO = "PRONTO",
  SERVIDO = "SERVIDO",
  CANCELADO = "CANCELADO",
}

export enum DiningOrderSource {
  EQUIPE = "EQUIPE",
  QR_MESA = "QR_MESA",
}

export enum ApplicationStatus {
  EM_ANALISE_IA = "EM_ANALISE_IA",
  RECUSADA_IA = "RECUSADA_IA",
  REVISAO_HUMANA = "REVISAO_HUMANA",
  APROVADA = "APROVADA",
  RECUSADA = "RECUSADA",
}

export enum SubscriptionStatus {
  PENDENTE = "PENDENTE",
  EM_TESTE = "EM_TESTE",
  ATIVA = "ATIVA",
  INADIMPLENTE = "INADIMPLENTE",
  CANCELADA = "CANCELADA",
}

export enum CommissionStatus {
  PENDENTE = "PENDENTE",
  PROCESSANDO = "PROCESSANDO",
  DISPONIVEL = "DISPONIVEL",
  PAGA = "PAGA",
  ESTORNADA = "ESTORNADA",
}

export enum PayoutBatchStatus {
  PROCESSANDO = "PROCESSANDO",
  PAGO = "PAGO",
  FALHOU = "FALHOU",
}

export enum StripeEventStatus {
  PENDENTE = "PENDENTE",
  PROCESSANDO = "PROCESSANDO",
  PROCESSADO = "PROCESSADO",
  FALHOU = "FALHOU",
}

export enum AccountTokenType {
  VERIFICACAO_EMAIL = "VERIFICACAO_EMAIL",
  REDEFINICAO_SENHA = "REDEFINICAO_SENHA",
  LOGIN_MFA = "LOGIN_MFA",
}

export enum IdentityDocumentOwnerType {
  USER = "USER",
  COMPANY = "COMPANY",
}

export enum LeadStatus {
  DISPONIVEL = "DISPONIVEL",
  EM_ATENDIMENTO = "EM_ATENDIMENTO",
  PROPOSTA = "PROPOSTA",
  CONVERTIDO = "CONVERTIDO",
  PERDIDO = "PERDIDO",
}
