import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { Role } from "@prisma/client";
import { tenantContext } from "../tenant/tenant-context";
import { AuthenticatedRequest } from "../interfaces/jwt-payload.interface";

/**
 * Resolve o companyId do request (do JWT, ou explícito para SUPER_ADMIN via
 * ?companyId=/x-company-id) e disponibiliza via AsyncLocalStorage para o Prisma
 * extension de tenant (ver prisma-client.factory.ts). Roda depois dos guards, então
 * `request.user` já está populado pelo JwtAuthGuard quando existir.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    let companyId: string | null = null;
    let bypass = false;

    if (!user) {
      bypass = true; // rota pública: o service resolve o companyId explicitamente
    } else if (user.role === Role.SUPER_ADMIN) {
      const explicit = (request.query?.companyId as string) || (request.headers["x-company-id"] as string);
      if (explicit) {
        companyId = explicit;
      } else {
        bypass = true;
      }
    } else if (user.companyId) {
      companyId = user.companyId;
    } else {
      bypass = true; // CLIENTE: sem empresa fixa, escopo resolvido por rota
    }

    return new Observable((subscriber) => {
      tenantContext.run({ companyId, bypass }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
