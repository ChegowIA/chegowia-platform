import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest } from "../interfaces/jwt-payload.interface";

/**
 * Na visão auditada de parceiro, resolve a carteira alvo sem trocar `sub`.
 * Fora dela, devolve o dono real da sessão normalmente.
 */
export const CurrentResellerUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  const identity = request.user;
  return identity?.assumedAccessKind === "RESELLER" && identity.assumedUserId
    ? identity.assumedUserId
    : identity?.sub;
});
