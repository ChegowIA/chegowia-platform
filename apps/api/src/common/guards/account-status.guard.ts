import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role, SubscriptionStatus } from "@prisma/client";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ALLOW_INACTIVE_SUBSCRIPTION_KEY } from "../decorators/allow-inactive-subscription.decorator";
import { AuthenticatedRequest } from "../interfaces/jwt-payload.interface";
import { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { PRISMA_CLIENT } from "../prisma/prisma.constants";

const COMPANY_ROLES = new Set<Role>([
  Role.ADMIN,
  Role.FUNCIONARIO,
  Role.COZINHA,
  Role.MOTOBOY,
  Role.GARCOM,
]);

@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const allowInactiveSubscription = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INACTIVE_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const identity = request.user;
    if (!identity) throw new UnauthorizedException();

    const user = await (this.prisma as any).user.findUnique({
      where: { id: identity.sub },
      select: {
        id: true,
        isActive: true,
        role: true,
        companyId: true,
        emailVerifiedAt: true,
      },
    });
    if (!user?.isActive || user.role !== identity.role || user.companyId !== identity.companyId) {
      throw new UnauthorizedException("Sua sessão não é mais válida.");
    }
    if (!user.emailVerifiedAt) throw new ForbiddenException("Confirme seu e-mail para continuar.");

    if (identity.role === Role.REVENDEDOR) {
      const profile = await (this.prisma as any).resellerProfile.findUnique({
        where: { userId: identity.sub },
        select: { isActive: true },
      });
      if (!profile?.isActive) throw new ForbiddenException("Perfil de revendedor inativo.");
    }

    if (COMPANY_ROLES.has(identity.role)) {
      if (!identity.companyId) throw new ForbiddenException("Usuário sem empresa vinculada.");
      const company = await (this.prisma as any).company.findUnique({
        where: { id: identity.companyId },
        select: {
          isActive: true,
          subscription: { select: { status: true, trialEndsAt: true } },
        },
      });
      if (!company?.isActive) throw new ForbiddenException("Empresa inativa.");
      const enforce = process.env.BILLING_ENFORCEMENT === "true"
        || (process.env.NODE_ENV === "production" && process.env.BILLING_ENFORCEMENT !== "false");
      const trialActive = company.subscription?.status === SubscriptionStatus.EM_TESTE
        && Boolean(company.subscription.trialEndsAt && company.subscription.trialEndsAt.getTime() > Date.now());
      const trialExpired = company.subscription?.status === SubscriptionStatus.EM_TESTE
        && Boolean(company.subscription.trialEndsAt && company.subscription.trialEndsAt.getTime() <= Date.now());
      const subscriptionAllowsAccess = company.subscription?.status === SubscriptionStatus.ATIVA || trialActive;
      if (
        !allowInactiveSubscription
        && (trialExpired || (enforce && !subscriptionAllowsAccess))
      ) {
        throw new ForbiddenException(
          trialExpired
            ? "Seu teste gratuito terminou. Pague a fatura de ativação para liberar todos os recursos."
            : company.subscription?.status === SubscriptionStatus.INADIMPLENTE
            ? "Assinatura inadimplente. Regularize o pagamento para continuar."
            : "A assinatura da empresa não está ativa.",
        );
      }
    }
    return true;
  }
}
