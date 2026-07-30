import { SetMetadata } from "@nestjs/common";
import { PermissionKey } from "@chegowia/shared";

export const PERMISSIONS_KEY = "permissions";
/**
 * Exige que o FUNCIONARIO logado tenha a permissão granular informada.
 * ADMIN e SUPER_ADMIN sempre passam (têm acesso total à própria empresa/plataforma).
 */
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
