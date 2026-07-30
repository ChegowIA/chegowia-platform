import { PermissionKey, Role } from "./enums";

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: "Super Admin",
  [Role.ADMIN]: "Administrador",
  [Role.FUNCIONARIO]: "Funcionário",
  [Role.COZINHA]: "Cozinha",
  [Role.MOTOBOY]: "Motoboy",
  [Role.CLIENTE]: "Cliente",
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  [PermissionKey.PEDIDOS_VISUALIZAR]: "Ver pedidos",
  [PermissionKey.PEDIDOS_EDITAR]: "Editar pedidos",
  [PermissionKey.PEDIDOS_CANCELAR]: "Cancelar pedidos",
  [PermissionKey.CARDAPIO_VISUALIZAR]: "Ver cardápio",
  [PermissionKey.CARDAPIO_EDITAR]: "Editar cardápio",
  [PermissionKey.ENTREGAS_VISUALIZAR]: "Ver entregas",
  [PermissionKey.ENTREGAS_EDITAR]: "Editar entregas",
  [PermissionKey.FUNCIONARIOS_VISUALIZAR]: "Ver funcionários",
  [PermissionKey.FUNCIONARIOS_EDITAR]: "Editar funcionários",
  [PermissionKey.RELATORIOS_VISUALIZAR]: "Ver relatórios",
  [PermissionKey.CONFIGURACOES_EDITAR]: "Editar configurações",
};

/** Permissões padrão sugeridas ao criar um funcionário com este cargo. */
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<string, PermissionKey[]> = {
  FUNCIONARIO: [
    PermissionKey.PEDIDOS_VISUALIZAR,
    PermissionKey.PEDIDOS_EDITAR,
    PermissionKey.CARDAPIO_VISUALIZAR,
    PermissionKey.ENTREGAS_VISUALIZAR,
  ],
  COZINHA: [PermissionKey.PEDIDOS_VISUALIZAR, PermissionKey.PEDIDOS_EDITAR],
  MOTOBOY: [PermissionKey.ENTREGAS_VISUALIZAR, PermissionKey.ENTREGAS_EDITAR],
};
