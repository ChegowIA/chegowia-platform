import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { BLOCK_RESELLER_SUPPORT_WRITE_KEY } from "../decorators/block-reseller-support-write.decorator";
import { AuthenticatedRequest } from "../interfaces/jwt-payload.interface";

/**
 * A conta de parceiro é aberta pelo superadmin para diagnóstico de dados reais,
 * não para criar leads, abrir contas de pagamento ou solicitar repasses em nome
 * de outra pessoa. A API impõe isto mesmo se alguém manipular a interface.
 */
@Injectable()
export class BlockResellerSupportWriteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const blocked = this.reflector.getAllAndOverride<boolean>(BLOCK_RESELLER_SUPPORT_WRITE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!blocked) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user?.assumed && user.assumedAccessId && user.assumedAccessKind === "RESELLER") {
      throw new ForbiddenException("A visão de suporte do revendedor é somente leitura.");
    }
    return true;
  }
}
