import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/** Guard global: exige JWT válido em toda rota, exceto as marcadas com @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

/**
 * Rotas públicas normalmente não precisam de identidade. Algumas delas,
 * porém, precisam reconhecer uma conta válida sem transformar a visita
 * anônima em login obrigatório (catálogo de homologação, por exemplo).
 *
 * Token ausente ou inválido continua sendo tratado como visitante anônimo.
 * O token válido é processado pelo Passport e fica em `request.user`.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    if (!request.headers?.authorization?.trim()) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(_error: unknown, user: TUser): TUser {
    // Ao contrário do guard obrigatório, token inválido não interrompe uma
    // rota pública: ela segue como visitante anônimo. O tipo genérico mantém
    // a assinatura exigida por `IAuthGuard`.
    return user;
  }
}
