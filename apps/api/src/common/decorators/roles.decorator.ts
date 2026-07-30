import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

export const ROLES_KEY = "roles";
/** Restringe a rota aos Roles informados. Combine com RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
