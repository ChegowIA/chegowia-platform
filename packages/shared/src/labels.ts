import {
  DeliveryProblemReason,
  FiscalEnvironment,
  PermissionKey,
  Role,
  TaxRegime,
} from "./enums";

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: "Super Admin",
  [Role.ADMIN]: "Administrador",
  [Role.FUNCIONARIO]: "Funcionário",
  [Role.COZINHA]: "Cozinha",
  [Role.MOTOBOY]: "Motoboy",
  [Role.GARCOM]: "Garçom",
  [Role.CLIENTE]: "Cliente",
  [Role.REVENDEDOR]: "Revendedor",
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  [PermissionKey.PEDIDOS_VISUALIZAR]: "Ver pedidos",
  [PermissionKey.PEDIDOS_EDITAR]: "Editar pedidos",
  [PermissionKey.PEDIDOS_CANCELAR]: "Cancelar pedidos",
  [PermissionKey.MESAS_VISUALIZAR]: "Ver mesas e comandas",
  [PermissionKey.MESAS_OPERAR]: "Abrir mesas e operar comandas",
  [PermissionKey.CARDAPIO_VISUALIZAR]: "Ver cardápio",
  [PermissionKey.CARDAPIO_EDITAR]: "Editar cardápio",
  [PermissionKey.ENTREGAS_VISUALIZAR]: "Ver entregas",
  [PermissionKey.ENTREGAS_EDITAR]: "Editar entregas",
  [PermissionKey.FUNCIONARIOS_VISUALIZAR]: "Ver funcionários",
  [PermissionKey.FUNCIONARIOS_EDITAR]: "Editar funcionários",
  [PermissionKey.RELATORIOS_VISUALIZAR]: "Ver relatórios",
  [PermissionKey.CONFIGURACOES_EDITAR]: "Editar configurações",
  [PermissionKey.FISCAL_VISUALIZAR]: "Ver cadastro fiscal",
  [PermissionKey.FISCAL_CONFIGURAR]: "Configurar dados fiscais e certificado",
  [PermissionKey.CAIXA_VISUALIZAR]: "Ver caixa e turnos",
  [PermissionKey.CAIXA_OPERAR]: "Abrir, movimentar e fechar o caixa",
  [PermissionKey.CAIXA_GERENCIAR]: "Criar e desativar pontos de venda",
  [PermissionKey.ATENDIMENTO_VISUALIZAR]: "Ver conversas do WhatsApp",
  [PermissionKey.ATENDIMENTO_RESPONDER]: "Responder e apagar conversas do WhatsApp",
};

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  [TaxRegime.SIMPLES_NACIONAL]: "Simples Nacional",
  [TaxRegime.SIMPLES_NACIONAL_EXCESSO]: "Simples Nacional — excesso de sublimite",
  [TaxRegime.REGIME_NORMAL]: "Regime normal (Lucro Presumido ou Real)",
};

export const FISCAL_ENVIRONMENT_LABELS: Record<FiscalEnvironment, string> = {
  [FiscalEnvironment.HOMOLOGACAO]: "Homologação (sem valor fiscal)",
  [FiscalEnvironment.PRODUCAO]: "Produção",
};

/** Permissões padrão sugeridas ao criar um funcionário com este cargo. */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<string, PermissionKey[]> = {
  FUNCIONARIO: [
    PermissionKey.CAIXA_VISUALIZAR,
    PermissionKey.CAIXA_OPERAR,
    PermissionKey.PEDIDOS_VISUALIZAR,
    PermissionKey.PEDIDOS_EDITAR,
    PermissionKey.MESAS_VISUALIZAR,
    PermissionKey.MESAS_OPERAR,
    PermissionKey.CARDAPIO_VISUALIZAR,
    PermissionKey.ENTREGAS_VISUALIZAR,
  ],
  COZINHA: [
    PermissionKey.PEDIDOS_VISUALIZAR,
    PermissionKey.PEDIDOS_EDITAR,
    PermissionKey.MESAS_VISUALIZAR,
    PermissionKey.MESAS_OPERAR,
  ],
  MOTOBOY: [PermissionKey.ENTREGAS_VISUALIZAR, PermissionKey.ENTREGAS_EDITAR],
  GARCOM: [
    PermissionKey.MESAS_VISUALIZAR,
    PermissionKey.MESAS_OPERAR,
    PermissionKey.CARDAPIO_VISUALIZAR,
  ],
};

/** Grupos apresentados ao administrador ao configurar os acessos de uma pessoa. */
export const PERMISSION_SECTIONS: Array<{
  title: string;
  description: string;
  keys: PermissionKey[];
}> = [
  {
    title: "Pedidos",
    description: "Acompanhar, alterar ou cancelar pedidos gerais.",
    keys: [
      PermissionKey.PEDIDOS_VISUALIZAR,
      PermissionKey.PEDIDOS_EDITAR,
      PermissionKey.PEDIDOS_CANCELAR,
    ],
  },
  {
    title: "Mesas e salão",
    description: "Ver mesas, abrir atendimentos, lançar rodadas e servir pedidos.",
    keys: [PermissionKey.MESAS_VISUALIZAR, PermissionKey.MESAS_OPERAR],
  },
  {
    title: "Cardápio",
    description: "Consultar ou alterar produtos e categorias.",
    keys: [PermissionKey.CARDAPIO_VISUALIZAR, PermissionKey.CARDAPIO_EDITAR],
  },
  {
    title: "Entregas",
    description: "Acompanhar e atualizar entregas.",
    keys: [PermissionKey.ENTREGAS_VISUALIZAR, PermissionKey.ENTREGAS_EDITAR],
  },
  {
    title: "Equipe",
    description: "Consultar pessoas e configurar os acessos delas.",
    keys: [PermissionKey.FUNCIONARIOS_VISUALIZAR, PermissionKey.FUNCIONARIOS_EDITAR],
  },
  {
    title: "Fiscal",
    description: "Cadastro fiscal, certificado digital e numeração de notas.",
    keys: [PermissionKey.FISCAL_VISUALIZAR, PermissionKey.FISCAL_CONFIGURAR],
  },
  {
    title: "Caixa",
    description: "Abrir turno, registrar sangria e suprimento, fechar com conferência.",
    keys: [PermissionKey.CAIXA_VISUALIZAR, PermissionKey.CAIXA_OPERAR, PermissionKey.CAIXA_GERENCIAR],
  },
  {
    title: "Relatórios",
    description: "Consultar indicadores e resultados da operação.",
    keys: [PermissionKey.RELATORIOS_VISUALIZAR],
  },
];

export const DELIVERY_PROBLEM_REASON_LABELS: Record<DeliveryProblemReason, string> = {
  [DeliveryProblemReason.CLIENTE_NAO_ATENDEU]: "Cliente não atendeu",
  [DeliveryProblemReason.ENDERECO_NAO_LOCALIZADO]: "Endereço não localizado",
  [DeliveryProblemReason.CLIENTE_RECUSOU]: "Cliente recusou o pedido",
  [DeliveryProblemReason.VEICULO_COM_PROBLEMA]: "Problema com o veículo",
  [DeliveryProblemReason.PEDIDO_DANIFICADO]: "Pedido danificado",
  [DeliveryProblemReason.AREA_DE_RISCO]: "Área sem acesso seguro",
  [DeliveryProblemReason.OUTRO]: "Outro motivo",
};
