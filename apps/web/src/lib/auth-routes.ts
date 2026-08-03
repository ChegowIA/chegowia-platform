import { Role } from "@chegowia/shared";

export function homePathForRole(role: Role): string {
  if (role === Role.SUPER_ADMIN) return "/super-admin/dashboard";
  if (role === Role.REVENDEDOR) return "/revendedor/dashboard";
  if (role === Role.MOTOBOY) return "/painel/entregas";
  if (role === Role.GARCOM) return "/painel/mesas";
  if (role === Role.COZINHA) return "/painel/pedidos";
  if (role === Role.CLIENTE) return "/";
  return "/painel/dashboard";
}

export function isBackofficeRole(role: Role): boolean {
  return role !== Role.CLIENTE && role !== Role.REVENDEDOR;
}
