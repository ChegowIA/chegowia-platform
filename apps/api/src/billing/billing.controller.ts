import { Body, Controller, Get, Headers, Param, Patch, Post, RawBodyRequest, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { BillingService } from "./billing.service";
import { ClientApplicationDto } from "./dto/client-application.dto";
import { AsaasSubaccountDto } from "./dto/asaas-subaccount.dto";
import { AllowInactiveSubscription } from "../common/decorators/allow-inactive-subscription.decorator";

@ApiTags("billing")
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get("plans")
  plans() { return this.billing.listPlans(); }

  /**
   * A página pública mostra a regra de cobrança antes do cadastro. A resposta
   * expõe o valor final por métrica, nunca custo interno nem margem.
   */
  @Public()
  @Get("pricing")
  pricing() { return this.billing.publicPricing(); }

  @Roles(Role.SUPER_ADMIN)
  @Patch("admin/plans/:id")
  updatePlan(@Param("id") id: string, @Body() body: { monthlyPrice?: number; stripePriceId?: string; isActive?: boolean }) {
    return this.billing.updatePlan(id, body);
  }

  /**
   * Validar um código é ação pontual — 10/min é folgado para uso legítimo e
   * encarece a enumeração da rede de revendedores, já que o código segue um
   * padrão previsível.
   */
  @Public()
  @Get("referral/:code")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  validateCode(@Param("code") code: string) { return this.billing.validateCode(code); }

  @Public()
  @Post("applications")
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  apply(@Body() dto: ClientApplicationDto) {
    return this.billing.apply(dto);
  }

  @Public()
  @Post("applications/:id/checkout")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@Param("id") id: string) {
    return this.billing.checkout(id);
  }

  @Roles(Role.REVENDEDOR)
  @Post("reseller/payment-links")
  resellerPaymentLink(
    @CurrentUser("sub") userId: string,
    @Body() dto: ClientApplicationDto,
  ) {
    return this.billing.createForReseller(userId, dto);
  }

  /**
   * O corpo só é usado pelo Asaas, que abre a subconta pela API e precisa do
   * endereço e da renda declarada. No Stripe o onboarding é hospedado e a
   * chamada segue sem corpo.
   */
  @Roles(Role.REVENDEDOR)
  @Post("reseller/connect")
  connect(@CurrentUser("sub") userId: string, @Body() dto?: AsaasSubaccountDto) {
    return this.billing.connectOnboarding(userId, dto);
  }

  @Roles(Role.REVENDEDOR)
  @Get("reseller/connect/status")
  connectStatus(@CurrentUser("sub") userId: string) { return this.billing.connectStatus(userId); }

  @Roles(Role.REVENDEDOR)
  @Post("reseller/payout")
  payout(@CurrentUser("sub") userId: string) { return this.billing.requestPayout(userId); }

  @Roles(Role.ADMIN)
  @AllowInactiveSubscription()
  @Get("company/status")
  companyStatus(@CurrentUser("companyId") companyId: string) {
    return this.billing.companyBillingStatus(companyId);
  }

  @Roles(Role.ADMIN)
  @AllowInactiveSubscription()
  @Post("company/portal")
  companyPortal(@CurrentUser("companyId") companyId: string) {
    return this.billing.companyPortal(companyId);
  }

  @Roles(Role.ADMIN)
  @AllowInactiveSubscription()
  @Get("company/invoices")
  companyInvoices(@CurrentUser("companyId") companyId: string) {
    return this.billing.companyInvoices(companyId);
  }

  @Roles(Role.ADMIN)
  @AllowInactiveSubscription()
  @Post("company/cancel")
  companyCancel(@CurrentUser("companyId") companyId: string) {
    return this.billing.cancelCompanySubscription(companyId);
  }

  /** Disponível mesmo com o painel bloqueado ao final do teste. */
  @Roles(Role.ADMIN)
  @AllowInactiveSubscription()
  @Post("company/checkout")
  companyCheckout(@CurrentUser("companyId") companyId: string) {
    return this.billing.companyCheckout(companyId);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/applications")
  applications() { return this.billing.listClientApplications(); }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/operational-status")
  operationalStatus() { return this.billing.operationalStatus(); }

  @Roles(Role.SUPER_ADMIN)
  @Post("admin/stripe-events/:id/retry")
  retryStripeEvent(@Param("id") id: string) { return this.billing.retryStripeEvent(id); }

  @Roles(Role.SUPER_ADMIN)
  @Post("admin/applications/:id/approve")
  approve(@Param("id") id: string) {
    return this.billing.approveClientApplication(id);
  }

  /**
   * Webhook do Asaas. Não há assinatura do corpo como no Stripe: a autenticação
   * é o token configurado ao criar o webhook, devolvido no header
   * `asaas-access-token`. Sem ele qualquer um marcaria assinatura como paga.
   */
  @Public()
  @Post("asaas/webhook")
  @SkipThrottle()
  asaasWebhook(
    @Headers("asaas-access-token") token: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.billing.handleAsaasWebhook(token, payload);
  }

  @Public()
  @Post("stripe/webhook")
  @SkipThrottle()
  webhook(
    @Headers("stripe-signature") signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.billing.handleWebhook(signature, request.rawBody!);
  }

  @Public()
  @Post("stripe/connect-webhook")
  @SkipThrottle()
  connectWebhook(
    @Headers("stripe-signature") signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.billing.handleWebhook(signature, request.rawBody!, "connect");
  }
}
