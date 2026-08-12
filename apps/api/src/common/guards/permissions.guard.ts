import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { PERMISSIONS_KEY } from "../decorators/require-permission.decorator";
import { AuthenticatedRequest } from "../interfaces/jwt-payload.interface";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";

/**
 * Checa permissões granulares de um FUNCIONARIO/COZINHA/MOTOBOY/GARCOM para o módulo da
 * rota. ADMIN e SUPER_ADMIN sempre passam — eles têm acesso irrestrito à própria
 * empresa/plataforma (ver regras.md, seção 1).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new ForbiddenException("Não autenticado.");
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) return true;
    /**
     * Contexto assumido pelo superadmin multiacesso: as permissões de papel
     * operacional vêm do EmployeeProfile, que a conta de plataforma não tem —
     * sem esta saída, entrar como cozinha ou motoboy daria uma tela vazia.
     *
     * Não é afrouxamento: o AccountStatusGuard revalida a cada requisição que a
     * conta por trás do token ainda é superadmin e continua na lista autorizada
     * por ambiente. Quem chega aqui já teria acesso irrestrito como plataforma.
     */
    if (user.assumed) return true;
    const employeeProfile = await (this.prisma as any).employeeProfile.findUnique({
      where: { userId: user.sub },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const grantedKeys = new Set<string>(
      (employeeProfile?.rolePermissions ?? []).map((rp: any) => rp.permission.key),
    );

    const hasAll = required.every((key) => grantedKeys.has(key));
    if (!hasAll) {
      throw new ForbiddenException("Você não tem permissão para executar esta ação.");
    }
    return true;
  }
}
