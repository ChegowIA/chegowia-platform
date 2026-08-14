import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  ApplicationStatus,
  CommissionStatus,
  LeadStatus,
  PayoutBatchStatus,
  Role,
  StripeEventStatus,
  BillingProvider,
  SubscriptionStatus,
  UsageLedgerStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import Stripe from "stripe";
import { createHash, timingSafeEqual } from "node:crypto";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { slugify } from "../common/utils/slugify";
import { AI_PROVIDER, AIProvider } from "../ai/providers/ai-provider.interface";
import { ClientApplicationDto } from "./dto/client-application.dto";
import { normalizeBrazilDocument } from "../common/validators/brazil-document.validator";
import { AuthService } from "../auth/auth.service";
import { AsaasProvider, AsaasPayment, AsaasTransfer } from "./asaas.provider";
import { UsageService } from "../usage/usage.service";
import { MailService } from "../common/mail/mail.service";
import { runsBackgroundJobs } from "../common/config/app-role";
import { AsaasSubaccountDto } from "./dto/asaas-subaccount.dto";
import { readSecretKey, sealSecret } from "../common/utils/secret-box";

const MAX_PAYOUT_ATTEMPTS = 10;
const MAX_STRIPE_EVENT_ATTEMPTS = 10;
const FREE_TRIAL_DAYS = 7;
/**
 * Uma assinatura já fora do período pago não pode ganhar carência silenciosa.
 * Um minuto limita chamadas repetidas ao Asaas sem transformar a virada de
 * vencimento em uma espera de quinze minutos.
 */
const ASAAS_OVERDUE_RECHECK_INTERVAL_MS = 60_000;
/** A baixa do consumo é rechecada rapidamente quando não houver webhook. */
const ASAAS_USAGE_RECHECK_INTERVAL_MS = 60_000;
/** Uma transferência interna que não voltou como concluída é conferida logo. */
const ASAAS_PAYOUT_RECHECK_INTERVAL_MS = 60_000;
/** Regra comercial única: 30% da mensalidade do plano pertence ao revendedor. */
const RESELLER_COMMISSION_RATE = 0.30;
/**
 * `CONFIRMED` autoriza a assinatura, mas não é saldo disponível. Para saque do
 * revendedor só importam os estados em que o Asaas efetivamente recebeu o
 * dinheiro na conta raiz.
 */
const ASAAS_SETTLED_PAYMENT_STATUSES = ["RECEIVED", "RECEIVED_IN_CASH"];
const COMMISSION_HOLD_AWAITING_SETTLEMENT = "AGUARDANDO_COMPENSACAO_ASAAS";
const COMMISSION_HOLD_CHARGEBACK = "CONTESTACAO_DE_PAGAMENTO";
/**
 * Situações em que o dinheiro já é nosso. `CONFIRMED` é pagamento reconhecido com
 * saldo ainda a liberar e `RECEIVED` é saldo disponível — para liberar acesso os
 * dois valem, e esperar só o segundo deixaria o cliente pagando e esperando.
 */
export const ASAAS_PAID_STATUSES = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];

/** O revendedor acompanha a subconta pelo painel do próprio Asaas. */
const ASAAS_RESELLER_DASHBOARD_URL = "https://www.asaas.com/login";

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  private stripeWorker?: NodeJS.Timeout;
  private backgroundJobsRunning = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
    private readonly auth: AuthService,
    private readonly usage: UsageService,
    private readonly mail: MailService,
    private readonly asaas: AsaasProvider,
  ) {}

  private db() { return this.prisma as any; }

  /**
   * Quando cada consulta de conciliação foi feita pela última vez.
   *
   * As rotinas rodam a cada 5s, mas algumas consultas só precisam ser feitas
   * periodicamente. A exceção é o vencimento: ele é rechecado a cada minuto,
   * pois uma janela maior vira carência não intencional para quem não pagou.
   *
   * Em memória de propósito: perder o registro no restart custa uma consulta a
   * mais, e não vale uma coluna no banco.
   */
  private readonly ultimaConferencia = new Map<string, number>();

  private deveConferir(chave: string, intervaloMs: number) {
    const anterior = this.ultimaConferencia.get(chave) ?? 0;
    if (Date.now() - anterior < intervaloMs) return false;
    this.ultimaConferencia.set(chave, Date.now());
    return true;
  }

  onModuleInit() {
    // Nas réplicas de HTTP puro a fila não roda: quem processa é o serviço com
    // APP_ROLE=worker. Ver common/config/app-role.ts.
    if (!runsBackgroundJobs()) {
      this.logger.log("Processo em papel de API: fila de cobrança não será processada aqui.");
      return;
    }
    this.stripeWorker = setInterval(() => {
      void this.processBackgroundJobs();
    }, 5_000);
    this.stripeWorker.unref();
    void this.processBackgroundJobs();
  }

  onModuleDestroy() {
    if (this.stripeWorker) clearInterval(this.stripeWorker);
  }

  async listPlans() {
    const plans = await this.db().softwarePlan.findMany({
      where: { isActive: true },
      orderBy: [{ isFeatured: "desc" }, { monthlyPrice: "asc" }],
    });
    return plans.map((plan: any) => ({
      ...plan,
      monthlyPrice: this.effectivePlanMonthlyPrice(plan),
    }));
  }

  /** Preço comercial exibido e escolhido por novas empresas. */
  private effectivePlanMonthlyPrice(plan: { monthlyPrice: unknown }) {
    return Number(plan.monthlyPrice);
  }

  /** Assinaturas existentes mantêm o preço congelado no momento da adesão. */
  private effectiveSubscriptionMonthlyPrice(subscription: {
    monthlyPriceSnapshot?: unknown;
    plan: { monthlyPrice: unknown };
  }) {
    return subscription.monthlyPriceSnapshot === null || subscription.monthlyPriceSnapshot === undefined
      ? Number(subscription.plan.monthlyPrice)
      : Number(subscription.monthlyPriceSnapshot);
  }

  /**
   * Não usamos uma taxa configurável na emissão: o programa comercial vigente
   * promete 30%, e a taxa gravada no razão é o snapshot auditável dessa regra.
   * Se houver dado legado divergente, preservamos o registro antigo, mas nunca
   * criamos uma nova comissão diferente do contrato anunciado ao revendedor.
   */
  private resellerCommissionRate(reseller?: { commissionRate?: unknown } | null) {
    const configured = Number(reseller?.commissionRate);
    if (Number.isFinite(configured) && Math.abs(configured - RESELLER_COMMISSION_RATE) > 0.0001) {
      this.logger.warn(
        `Taxa de comissão divergente (${configured}) encontrada; aplicando a regra comercial de ${RESELLER_COMMISSION_RATE * 100}%.`,
      );
    }
    return RESELLER_COMMISSION_RATE;
  }

  /** A comissão incide na mensalidade, nunca nos créditos de IA/WhatsApp. */
  private commissionableMonthlyAmount(subscription: any, paymentValue: unknown) {
    const received = Math.max(0, Number(paymentValue ?? 0));
    const monthly = subscription?.plan
      ? Math.max(0, this.effectiveSubscriptionMonthlyPrice(subscription))
      : received;
    // Uma cobrança pode conter consumo variável além do plano. Também nunca
    // prometemos comissão maior que o dinheiro efetivamente pago pelo cliente.
    return Math.min(received, monthly);
  }

  /** Cadastros históricos sem teste continuam conciliáveis; os novos exigem os 7 dias completos. */
  private hasCompletedCommissionTrial(subscription: { trialEndsAt?: Date | string | null }) {
    if (!subscription.trialEndsAt) return true;
    const trialEnd = new Date(subscription.trialEndsAt);
    return !Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() <= Date.now();
  }

  private asaasPostReceiptHoldDays() {
    const value = Number(process.env.ASAAS_COMMISSION_POST_RECEIPT_HOLD_DAYS ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private asaasPaymentHasSettledFunds(payment: { status?: unknown } | null | undefined) {
    return ASAAS_SETTLED_PAYMENT_STATUSES.includes(String(payment?.status ?? ""));
  }

  /**
   * O mesmo cliente pode ter outras cobranças no Asaas. Só a cobrança vinculada
   * à assinatura recorrente — ou a ativação que ainda está em aberto — gera
   * comissão. Isso impede pagar 30% sobre uso avulso ou depósito estranho.
   */
  private isAsaasSubscriptionMonthlyPayment(subscription: any, payment: any) {
    const paymentId = String(payment?.id ?? "");
    const remoteSubscription = payment?.subscription ? String(payment.subscription) : null;
    return Boolean(
      (remoteSubscription && subscription?.asaasSubscriptionId === remoteSubscription)
      || (paymentId && subscription?.asaasPaymentId === paymentId),
    );
  }

  /**
   * Transparência para a página de contratação. O cliente precisa ver quanto
   * cada unidade custa, mas custo de fornecedor e margem são dados comerciais
   * internos; por isso a API devolve somente a tarifa final que será aplicada
   * ao consumo novo.
   */
  async publicPricing() {
    const rates = await this.db().usageRate.findMany({
      where: { isActive: true },
      orderBy: { metric: "asc" },
    });

    return {
      billingCycle: "mensal",
      variableUsageBilling: "O consumo é consolidado e lançado na próxima fatura.",
      trial: {
        days: FREE_TRIAL_DAYS,
        description: "Durante os 7 dias de teste você não paga nada. IA e WhatsApp são medidos com transparência e entram na primeira fatura somente se você decidir assinar; se não seguir, nada é cobrado.",
      },
      rates: rates.map((rate: any) => {
        const providerUnitCost = Number(rate.providerUnitCost);
        const markupPercent = Number(rate.markupPercent);
        const pricePerUnit = roundPublicPrice(providerUnitCost * (1 + markupPercent / 100));
        return {
          metric: rate.metric,
          provider: rate.provider,
          label: rate.label,
          description: publicUsageDescription(rate.metric),
          unitSize: Number(rate.unitSize),
          pricePerUnit,
        };
      }),
    };
  }

  async updatePlan(id: string, data: { monthlyPrice?: number; stripePriceId?: string; isActive?: boolean }) {
    const plan = await this.db().softwarePlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plano não encontrado.");
    const nextMonthlyPrice = data.monthlyPrice ?? Number(plan.monthlyPrice);
    const planPriceChanged = data.monthlyPrice !== undefined
      && Math.round(nextMonthlyPrice * 100) !== Math.round(Number(plan.monthlyPrice) * 100);
    // Um Price ID aponta para um valor imutável na Stripe. Ao alterar o valor
    // local, removemos a referência antiga para nunca cobrar um preço obsoleto.
    const nextPriceId = data.stripePriceId === undefined
      ? (planPriceChanged ? null : undefined)
      : (data.stripePriceId.trim() || null);
    if (nextPriceId) {
      if (!this.stripe) throw new BadRequestException("Configure a Stripe antes de vincular um preço.");
      await this.assertStripePrice(nextPriceId, {
        monthlyPrice: nextMonthlyPrice,
        currency: plan.currency,
      });
    }
    return this.db().softwarePlan.update({
      where: { id },
      data: {
        monthlyPrice: data.monthlyPrice,
        stripePriceId: nextPriceId,
        isActive: data.isActive,
      },
    });
  }

  async validateCode(code: string) {
    const reseller = await this.db().resellerProfile.findFirst({
      where: { code: code.trim().toUpperCase(), isActive: true },
      include: { user: { select: { name: true } } },
    });
    /**
     * Só o primeiro nome. A rota é anônima e o código é previsível
     * (`NOME`+4 dígitos, ver `uniqueCode` em resellers.service.ts), então
     * devolver o nome completo permitia montar um diretório nome→código da
     * rede inteira por força bruta. O primeiro nome basta para a pessoa
     * reconhecer quem a indicou.
     */
    const firstName = reseller?.user.name.trim().split(/\s+/)[0] ?? "";
    return reseller ? { valid: true, code: reseller.code, resellerName: firstName, discountPercent: 15, months: 3 } : { valid: false };
  }

  async apply(dto: ClientApplicationDto, forcedResellerId?: string) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedDocument = normalizeBrazilDocument(dto.document);
    if (await this.db().user.findUnique({ where: { email: normalizedEmail } })) {
      throw new ConflictException("Este e-mail já possui uma conta ativa. Entre pelo login.");
    }
    const [documentUser, documentCompany] = await Promise.all([
      this.db().user.findUnique({ where: { document: normalizedDocument } }),
      this.db().company.findUnique({ where: { cnpj: normalizedDocument } }),
    ]);
    if (documentUser || documentCompany) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
    const plan = await this.db().softwarePlan.findFirst({ where: { id: dto.planId, isActive: true } });
    if (!plan) throw new NotFoundException("Plano indisponível.");
    let reseller: any = null;
    if (forcedResellerId) reseller = await this.db().resellerProfile.findUnique({ where: { id: forcedResellerId } });
    else if (dto.resellerCode) reseller = await this.db().resellerProfile.findFirst({ where: { code: dto.resellerCode.toUpperCase(), isActive: true } });
    if (dto.resellerCode && !reseller) throw new BadRequestException("Código de revendedor inválido.");

    const data = {
      planId: plan.id,
      resellerId: reseller?.id ?? null,
      resellerCode: reseller?.code ?? null,
      responsibleName: dto.responsibleName,
      email: normalizedEmail,
      phone: dto.phone,
      document: normalizedDocument,
      companyName: dto.companyName,
      tradeName: dto.tradeName,
      city: dto.city,
      state: dto.state.toUpperCase(),
      businessType: dto.businessType,
      operationDetails: dto.operationDetails,
      passwordHash: await bcrypt.hash(dto.password, 12),
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      automatedAnalysisAcceptedAt: new Date(),
      sourceLeadId: forcedResellerId ? dto.sourceLeadId ?? null : null,
      status: ApplicationStatus.EM_ANALISE_IA,
      aiScore: null,
      aiFeedback: null,
      aiAnalysis: undefined,
      stripeSessionId: null,
      isTestOnly: false,
      monthlyPriceSnapshot: this.effectivePlanMonthlyPrice(plan),
    };
    /**
     * Sempre cria um registro novo — nunca reaproveita uma candidatura
     * pendente do mesmo e-mail.
     *
     * A rota é anônima e não há prova de posse do e-mail. Reaproveitar
     * permitia que qualquer pessoa que soubesse o endereço de um cadastro em
     * andamento sobrescrevesse `passwordHash`, CNPJ e razão social da vítima —
     * e, se o pagamento fosse concluído depois, a empresa nasceria com a senha
     * do atacante. Expirar a sessão Stripe da pendência era o mesmo problema
     * pelo outro lado: derrubava o checkout de terceiro.
     *
     * Candidaturas abandonadas ficam órfãs com `companyId: null` e são inertes;
     * o checkout aponta para um id específico, então cada pessoa segue com a
     * sua. Confirmação por e-mail antes do cadastro é a evolução natural daqui.
     */
    const application = await this.db().clientApplication.create({ data });
    return this.evaluateClient(application);
  }

  async createForReseller(userId: string, dto: ClientApplicationDto) {
    const reseller = await this.db().resellerProfile.findUnique({ where: { userId } });
    if (!reseller || !reseller.isActive) throw new NotFoundException("Revendedor não encontrado.");
    if (dto.sourceLeadId) {
      const lead = await this.db().salesLead.findFirst({
        where: { id: dto.sourceLeadId, resellerId: reseller.id, status: { in: [LeadStatus.EM_ATENDIMENTO, LeadStatus.PROPOSTA] } },
      });
      if (!lead) throw new BadRequestException("Este lead não pertence à sua carteira ou não pode receber uma proposta.");
    }
    return this.apply({ ...dto, resellerCode: reseller.code }, reseller.id);
  }

  async connectOnboarding(userId: string, dto?: AsaasSubaccountDto) {
    if (this.billingProvider() === "ASAAS") return this.connectOnboardingAsaas(userId, dto);
    if (!this.stripe) throw new BadRequestException("Stripe Connect ainda não configurado.");
    const reseller = await this.db().resellerProfile.findUnique({ where: { userId }, include: { user: true } });
    if (!reseller) throw new NotFoundException("Revendedor não encontrado.");
    try {
      let accountId = reseller.stripeAccountId;
      let account: Stripe.Account;
      if (!accountId) {
        account = await this.createConnectAccount(reseller, userId);
        accountId = account.id;
        await this.db().resellerProfile.update({
          where: { id: reseller.id },
          data: {
            stripeAccountId: accountId,
            stripeOnboardingOk: this.isStripeAccountReady(account),
          },
        });
      } else {
        try {
          account = await this.stripe.accounts.retrieve(accountId);
        } catch (error) {
          if (!this.isMissingStripeResource(error)) throw error;
          account = await this.createConnectAccount(reseller, userId, accountId);
          accountId = account.id;
        }
        await this.db().resellerProfile.update({
          where: { id: reseller.id },
          data: {
            stripeAccountId: accountId,
            stripeOnboardingOk: this.isStripeAccountReady(account),
          },
        });
      }
      if (this.isStripeAccountReady(account)) {
        const loginLink = await this.stripe.accounts.createLoginLink(accountId);
        return { url: loginLink.url, destination: "dashboard" };
      }
      const appUrl = this.publicAppUrl();
      const link = await this.stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${appUrl}/revendedor/financeiro?stripe=refresh`,
        return_url: `${appUrl}/revendedor/financeiro?stripe=ok`,
      });
      return { url: link.url };
    } catch (error) {
      this.logger.error(`Falha no Stripe Connect para o revendedor ${reseller.id}`, this.stripeErrorForLog(error));
      throw new BadGatewayException(this.stripeErrorForUser(error, "Não foi possível iniciar a configuração de recebimentos."));
    }
  }

  private async createConnectAccount(
    reseller: { id: string; user: { email: string; document?: string | null } },
    userId: string,
    replacedAccountId?: string,
  ) {
    if (!this.stripe) throw new BadRequestException("Stripe Connect ainda não configurado.");
    const isCompany = reseller.user.document?.length === 14;
    return this.stripe.accounts.create(
      {
        type: "express",
        country: "BR",
        email: reseller.user.email,
        business_type: isCompany ? "company" : "individual",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { resellerId: reseller.id, userId },
      },
      {
        idempotencyKey: replacedAccountId
          ? `reseller-connect-account-${reseller.id}-replacement-${replacedAccountId}`
          : `reseller-connect-account-${reseller.id}`,
      },
    );
  }

  /**
   * Abertura da subconta que recebe a comissão. Não existe página hospedada como
   * no Stripe: a conta nasce pela API com os dados do formulário, e a partir daí
   * o revendedor acessa o painel do Asaas com o próprio e-mail.
   */
  private async connectOnboardingAsaas(userId: string, dto?: AsaasSubaccountDto) {
    const reseller = await this.db().resellerProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { name: true, email: true, phone: true, document: true } },
        application: { select: { document: true, phone: true, name: true } },
      },
    });
    if (!reseller) throw new NotFoundException("Revendedor não encontrado.");
    if (reseller.asaasWalletId) {
      return { url: ASAAS_RESELLER_DASHBOARD_URL, destination: "dashboard" as const, ready: true };
    }
    const rotulos: Array<[keyof AsaasSubaccountDto, string]> = [
      ["postalCode", "CEP"],
      ["address", "endereço"],
      ["addressNumber", "número"],
      ["province", "bairro"],
      ["incomeValue", "faturamento mensal"],
    ];
    const faltando = rotulos.filter(([campo]) => !dto?.[campo]).map(([, rotulo]) => rotulo);
    if (!dto || faltando.length) {
      throw new BadRequestException(
        `Preencha ${faltando.join(", ")} para abrir sua conta de recebimento.`,
      );
    }

    const documento = (reseller.user.document ?? reseller.application?.document ?? "").replace(/\D/g, "");
    if (documento.length !== 11 && documento.length !== 14) {
      this.logger.error(`Revendedor ${reseller.id} sem CPF/CNPJ válido; o Asaas não abre subconta sem documento.`);
      throw new BadRequestException(
        "Não encontramos um CPF/CNPJ válido no seu cadastro. Fale com o suporte da ChegowIA para corrigir antes de configurar os recebimentos.",
      );
    }
    // Pessoa física sem data de nascimento é recusada pelo Asaas; dizemos isso
    // aqui em vez de deixar o erro deles chegar cru na tela.
    if (documento.length === 11 && !dto.birthDate) {
      throw new BadRequestException("Informe sua data de nascimento para abrir a conta de recebimento.");
    }

    const telefone = (reseller.user.phone ?? reseller.application?.phone ?? "").replace(/\D/g, "");
    let subconta: Awaited<ReturnType<AsaasProvider["createSubaccount"]>>;
    try {
      subconta = await this.asaas.createSubaccount({
        name: reseller.user.name ?? reseller.application?.name ?? "Revendedor ChegowIA",
        email: reseller.user.email,
        cpfCnpj: documento,
        ...(telefone ? { mobilePhone: telefone } : {}),
        ...(documento.length === 11 && dto.birthDate ? { birthDate: dto.birthDate } : {}),
        ...(documento.length === 14 ? { companyType: "LIMITED" } : {}),
        incomeValue: dto.incomeValue!,
        address: dto.address,
        addressNumber: dto.addressNumber,
        ...(dto.complement ? { complement: dto.complement } : {}),
        province: dto.province,
        postalCode: dto.postalCode,
      });
    } catch (error) {
      // Sem idempotência na API deles, a segunda tentativa de um cadastro que já
      // foi gravado responde com erro. Recuperar a carteira é o que destrava.
      const recuperada = await this.asaas.findSubaccountByDocument(documento).catch(() => null);
      if (!recuperada) throw error;
      this.logger.warn(`Subconta do revendedor ${reseller.id} já existia no Asaas; carteira recuperada.`);
      subconta = recuperada;
    }

    await this.db().resellerProfile.update({
      where: { id: reseller.id },
      data: {
        asaasWalletId: subconta.walletId,
        asaasAccountId: subconta.id || null,
        asaasApiKeyEncrypted: this.sealAsaasKey(subconta.apiKey),
        asaasOnboardingOk: true,
      },
    });
    return { url: ASAAS_RESELLER_DASHBOARD_URL, destination: "dashboard" as const, ready: true, created: true };
  }

  /**
   * A chave da subconta volta uma única vez. Só guardamos cifrada, e só quando
   * há chave de cifra configurada — comissão é transferida pela conta raiz, então
   * perder essa chave não impede repasse, apenas consultas ao painel da subconta.
   */
  private sealAsaasKey(apiKey?: string | null) {
    if (!apiKey) return null;
    const key = readSecretKey("ASAAS_SUBACCOUNT_ENCRYPTION_KEY") ?? readSecretKey("FISCAL_ENCRYPTION_KEY");
    if (!key) {
      this.logger.warn(
        "Subconta Asaas criada sem ASAAS_SUBACCOUNT_ENCRYPTION_KEY: a chave da subconta foi descartada em vez de guardada em texto claro.",
      );
      return null;
    }
    return sealSecret(apiKey, key);
  }

  async connectStatus(userId: string) {
    if (this.billingProvider() === "ASAAS") {
      const reseller = await this.db().resellerProfile.findUnique({ where: { userId } });
      if (!reseller) throw new NotFoundException("Revendedor não encontrado.");
      return {
        provider: "ASAAS" as const,
        configured: true,
        ready: Boolean(reseller.asaasWalletId),
        status: reseller.asaasWalletId ? "ATIVO" : "NAO_INICIADO",
        // O formulário é nosso, não uma página hospedada: a tela precisa saber
        // que deve coletar estes campos antes de chamar a abertura da conta.
        requiresForm: !reseller.asaasWalletId,
        requirementsDue: [],
      };
    }
    if (!this.stripe) return { configured: false, ready: false, status: "NAO_CONFIGURADO" };
    const reseller = await this.db().resellerProfile.findUnique({ where: { userId } });
    if (!reseller) throw new NotFoundException("Revendedor não encontrado.");
    if (!reseller.stripeAccountId) return { configured: true, ready: false, status: "NAO_INICIADO" };
    try {
      const account = await this.stripe.accounts.retrieve(reseller.stripeAccountId);
      const ready = this.isStripeAccountReady(account);
      await this.db().resellerProfile.update({
        where: { id: reseller.id },
        data: { stripeOnboardingOk: ready },
      });
      return {
        configured: true,
        ready,
        status: ready ? "ATIVO" : account.details_submitted ? "EM_ANALISE" : "INCOMPLETO",
        requirementsDue: account.requirements?.currently_due ?? [],
      };
    } catch (error) {
      if (this.isMissingStripeResource(error)) {
        await this.db().resellerProfile.update({
          where: { id: reseller.id },
          data: {
            stripeAccountId: null,
            stripeOnboardingOk: false,
          },
        });
        return {
          configured: true,
          ready: false,
          status: "NAO_INICIADO",
          recovered: true,
          requirementsDue: [],
        };
      }
      this.logger.error(`Falha ao consultar a conta Connect ${reseller.stripeAccountId}`, this.stripeErrorForLog(error));
      throw new BadGatewayException(this.stripeErrorForUser(error, "Não foi possível consultar sua conta de recebimento."));
    }
  }

  async requestPayout(userId: string) {
    const asaas = this.billingProvider() === "ASAAS";
    if (!asaas && !this.stripe) throw new BadRequestException("Stripe Connect ainda não configurado.");
    const reseller = await this.db().resellerProfile.findUnique({ where: { userId } });
    if (!reseller) throw new NotFoundException("Revendedor não encontrado.");

    if (asaas) {
      if (!reseller.asaasWalletId) {
        throw new BadRequestException("Configure sua conta de recebimento antes de solicitar repasse.");
      }
    } else {
      if (!reseller.stripeAccountId) {
        throw new BadRequestException("Conclua e aguarde a aprovação da conta Stripe antes de solicitar repasse.");
      }
      const account = await this.stripe!.accounts.retrieve(reseller.stripeAccountId);
      if (!this.isStripeAccountReady(account)) {
        await this.db().resellerProfile.update({
          where: { id: reseller.id },
          data: { stripeOnboardingOk: false },
        });
        throw new BadRequestException("Sua conta Stripe ainda tem dados pendentes ou não está habilitada para repasses.");
      }
    }

    await this.releaseMatureCommissions(reseller.id);
    const batch = await this.db().$transaction(async (tx: any) => {
      const processing = await tx.payoutBatch.count({
        where: { resellerId: reseller.id, status: PayoutBatchStatus.PROCESSANDO },
      });
      if (processing > 0) {
        throw new ConflictException(
          "Já existe um repasse em processamento. Aguarde a confirmação antes de solicitar outro.",
        );
      }
      const entries = await tx.commissionLedger.findMany({
        where: { resellerId: reseller.id, status: CommissionStatus.DISPONIVEL },
        orderBy: { createdAt: "asc" },
      });
      const amount = entries.reduce((sum: number, item: any) => sum + Number(item.commissionAmount), 0);
      if (amount < 10) throw new BadRequestException("O saldo mínimo para repasse é R$ 10,00.");
      const created = await tx.payoutBatch.create({
        data: {
          resellerId: reseller.id,
          amount,
          currency: "brl",
          status: PayoutBatchStatus.PROCESSANDO,
        },
      });
      const locked = await tx.commissionLedger.updateMany({
        where: {
          id: { in: entries.map((item: any) => item.id) },
          status: CommissionStatus.DISPONIVEL,
        },
        data: { status: CommissionStatus.PROCESSANDO, payoutBatchId: created.id },
      });
      if (locked.count !== entries.length) {
        throw new ConflictException("O saldo mudou durante a solicitação. Tente novamente.");
      }
      return created;
    }, { isolationLevel: "Serializable" });

    return this.executePayoutBatch(batch.id);
  }

  private async executePayoutBatch(batchId: string, background = false) {
    const viaAsaas = this.billingProvider() === "ASAAS";
    if (!viaAsaas && !this.stripe) throw new BadRequestException("Stripe Connect ainda não configurado.");

    /**
     * Claim atômico antes de qualquer chamada ao provedor. Sem isso, dois
     * workers poderiam transferir o mesmo lote; a referência externa do Asaas
     * complementa a proteção quando a resposta se perde depois da criação.
     */
    const claimed = await this.db().payoutBatch.updateMany({
      where: {
        id: batchId,
        status: PayoutBatchStatus.PROCESSANDO,
        attempts: { lt: MAX_PAYOUT_ATTEMPTS },
      },
      data: {
        attempts: { increment: 1 },
        failureReason: null,
        nextAttemptAt: null,
      },
    }).catch(() => ({ count: 0 }));

    const batch = await this.db().payoutBatch.findUnique({
      where: { id: batchId },
      include: {
        reseller: { select: { stripeAccountId: true, asaasWalletId: true } },
        commissions: { select: { id: true } },
      },
    });
    if (!batch) throw new NotFoundException("Lote de repasse não encontrado.");

    if (claimed.count !== 1) {
      if (batch.status === PayoutBatchStatus.PAGO) {
        return {
          transferId: batch.stripeTransferId ?? batch.asaasTransferId,
          amount: Number(batch.amount),
          count: batch.commissions.length,
          alreadyProcessed: true,
        };
      }
      // Preso em PROCESSANDO com as tentativas esgotadas: o processo anterior
      // morreu entre o incremento e a conclusão. Encerra o lote para devolver
      // as comissões, em vez de deixá-las travadas para sempre.
      if (batch.status === PayoutBatchStatus.PROCESSANDO && batch.attempts >= MAX_PAYOUT_ATTEMPTS) {
        const reason = `O repasse foi interrompido após ${MAX_PAYOUT_ATTEMPTS} tentativas; o saldo voltou a ficar disponível para uma nova solicitação.`;
        await this.failPayoutBatch(batch.id, reason);
        this.logger.error(`Repasse ${batch.id} encerrado por esgotamento de tentativas.`);
        if (background) return null;
        throw new BadGatewayException(reason);
      }
      // Outro worker está processando este lote agora.
      if (background) return null;
      throw new ConflictException("Este lote não está disponível para processamento.");
    }

    if (!viaAsaas && !batch.reseller.stripeAccountId) {
      const reason = "A conta Stripe do revendedor não está configurada.";
      await this.failPayoutBatch(batch.id, reason);
      if (background) return null;
      throw new BadRequestException(reason);
    }
    if (viaAsaas && !batch.reseller.asaasWalletId) {
      const reason = "A conta de recebimento do revendedor não está configurada.";
      await this.failPayoutBatch(batch.id, reason);
      if (background) return null;
      throw new BadRequestException(reason);
    }

    const attempt = batch.attempts;
    try {
      const asaasTransfer = viaAsaas ? await this.transferPayoutViaAsaas(batch) : null;
      const transferId = asaasTransfer?.id
        ?? (await this.stripe!.transfers.create(
          {
            amount: Math.round(Number(batch.amount) * 100),
            currency: batch.currency,
            destination: batch.reseller.stripeAccountId!,
            metadata: {
              resellerId: batch.resellerId,
              payoutBatchId: batch.id,
              commissionCount: String(batch.commissions.length),
            },
          },
          { idempotencyKey: `reseller-payout-batch-${batch.id}` },
        )).id;

      // Em transferências entre carteiras o retorno costuma ser imediato, mas
      // não assumimos isso: `PENDING` não é dinheiro entregue. O lote continua
      // bloqueado até a confirmação para que o revendedor não receba duas vezes.
      if (asaasTransfer && !this.isAsaasTransferDone(asaasTransfer)) {
        if (this.isAsaasTransferTerminalFailure(asaasTransfer)) {
          throw new BadGatewayException("O Asaas recusou ou cancelou o repasse antes da conclusão.");
        }
        await this.db().payoutBatch.update({
          where: { id: batch.id },
          data: {
            asaasTransferId: transferId,
            failureReason: "Transferência criada e aguardando confirmação do Asaas.",
            nextAttemptAt: new Date(Date.now() + ASAAS_PAYOUT_RECHECK_INTERVAL_MS),
          },
        });
        return {
          transferId,
          amount: Number(batch.amount),
          count: batch.commissions.length,
          processing: true,
        };
      }

      const identificacao = viaAsaas ? { asaasTransferId: transferId } : { stripeTransferId: transferId };
      await this.completePayoutBatch(batch.id, identificacao);
      return {
        transferId,
        amount: Number(batch.amount),
        count: batch.commissions.length,
      };
    } catch (error) {
      const safeReason = viaAsaas
        ? this.asaasErrorForUser(error, "Falha ao enviar o repasse.")
        : this.stripeErrorForUser(error, "Falha ao enviar o repasse.");
      // A API do Asaas não tem idempotency key. Em uma queda entre a criação e
      // a resposta, liberar as comissões agora permitiria um segundo lote com
      // outra referência e pagamento duplicado. Mantemos o lote travado e
      // conferimos a referência original antes de qualquer nova tentativa.
      if (viaAsaas && attempt < MAX_PAYOUT_ATTEMPTS) {
        const retryDelayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 6));
        await this.db().payoutBatch.update({
          where: { id: batch.id },
          data: {
            failureReason: safeReason,
            nextAttemptAt: new Date(Date.now() + retryDelayMs),
          },
        });
        this.logger.warn(
          `Repasse Asaas ${batch.id} sem confirmação; conferiremos a mesma referência em ${Math.round(retryDelayMs / 1000)}s (tentativa ${attempt}).`,
        );
        if (background) return null;
        throw new BadGatewayException(
          "O Asaas ainda não confirmou o repasse. Estamos conferindo a transferência com segurança; não faça nova solicitação.",
        );
      }
      if (this.isRetryableStripeError(error) && attempt < MAX_PAYOUT_ATTEMPTS) {
        const retryDelayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 6));
        await this.db().payoutBatch.update({
          where: { id: batch.id },
          data: {
            failureReason: safeReason,
            nextAttemptAt: new Date(Date.now() + retryDelayMs),
          },
        });
        this.logger.warn(
          `Repasse ${batch.id} será tentado novamente em ${Math.round(retryDelayMs / 1000)}s (tentativa ${attempt}).`,
        );
        if (background) return null;
        throw new BadGatewayException(
          "A Stripe não confirmou o repasse agora. Ele continuará sendo tentado com segurança.",
        );
      }
      const exhaustedRetries = this.isRetryableStripeError(error);
      const finalReason = exhaustedRetries
        ? `${safeReason} Tentamos ${MAX_PAYOUT_ATTEMPTS} vezes sem confirmação; o saldo voltou a ficar disponível para uma nova solicitação.`
        : safeReason;
      await this.failPayoutBatch(batch.id, finalReason);
      this.logger.error(`Falha no repasse ${batch.id}`, this.stripeErrorForLog(error));
      if (background) return null;
      throw new BadGatewayException(finalReason);
    }
  }

  /**
   * Transferência da comissão para a carteira do revendedor.
   *
   * O Asaas não aceita chave de idempotência. Se a transferência sair e a
   * resposta se perder, a segunda tentativa pagaria de novo — por isso
   * consultamos pela `externalReference`, que é o id do lote, antes de criar.
   */
  private async transferPayoutViaAsaas(batch: { id: string; amount: unknown; reseller: { asaasWalletId: string | null } }) {
    const referencia = `payout-${batch.id}`;
    // Se a consulta falhar, não é seguro concluir que a transferência não
    // existe: ela pode ter sido criada pouco antes de uma queda de rede. O erro
    // sobe para o lote, que fica em processamento e consulta a mesma referência
    // mais tarde — criar outra agora poderia pagar o revendedor em duplicidade.
    const existente = await this.asaas.findTransferByReference(referencia);
    if (existente) {
      this.logger.warn(`Repasse ${batch.id} já tinha transferência ${existente.id} no Asaas; nenhuma nova foi criada.`);
      return existente;
    }
    const transferencia = await this.asaas.transferToWallet({
      value: Number(batch.amount),
      walletId: batch.reseller.asaasWalletId!,
      externalReference: referencia,
    });
    return transferencia;
  }

  private isAsaasTransferDone(transfer: { status?: string | null }) {
    return String(transfer.status ?? "").toUpperCase() === "DONE";
  }

  private isAsaasTransferTerminalFailure(transfer: { status?: string | null }) {
    return ["FAILED", "CANCELLED", "REFUSED", "BLOCKED"].includes(String(transfer.status ?? "").toUpperCase());
  }

  /** Marca o dinheiro como pago somente depois da confirmação do provedor. */
  private async completePayoutBatch(
    batchId: string,
    identification: { stripeTransferId?: string; asaasTransferId?: string },
  ) {
    await this.db().$transaction(async (tx: any) => {
      const claimed = await tx.payoutBatch.updateMany({
        where: { id: batchId, status: PayoutBatchStatus.PROCESSANDO },
        data: {
          status: PayoutBatchStatus.PAGO,
          ...identification,
          failureReason: null,
          nextAttemptAt: null,
          completedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return;
      await tx.commissionLedger.updateMany({
        where: { payoutBatchId: batchId, status: CommissionStatus.PROCESSANDO },
        data: { status: CommissionStatus.PAGA, paidAt: new Date(), ...identification },
      });
    });
  }

  /** Mensagem do Asaas já vem pronta para o usuário; só evitamos vazar texto longo. */
  private asaasErrorForUser(error: unknown, fallback: string) {
    const message = error instanceof HttpException ? error.message : null;
    return message && message.length > 0 && message.length < 300 ? message : fallback;
  }

  private async failPayoutBatch(batchId: string, reason: string) {
    await this.db().$transaction(async (tx: any) => {
      // Nunca troca um repasse já confirmado para FALHOU por causa de um evento
      // atrasado do Asaas ou de uma tentativa concorrente.
      const claimed = await tx.payoutBatch.updateMany({
        where: { id: batchId, status: PayoutBatchStatus.PROCESSANDO },
        data: {
          status: PayoutBatchStatus.FALHOU,
          failureReason: reason,
          nextAttemptAt: null,
          completedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return;
      await tx.commissionLedger.updateMany({
        where: { payoutBatchId: batchId, status: CommissionStatus.PROCESSANDO },
        data: { status: CommissionStatus.DISPONIVEL, payoutBatchId: null },
      });
    });
  }

  async companyBillingStatus(companyId: string) {
    const enforcementEnabled = process.env.BILLING_ENFORCEMENT === "true"
      || (process.env.NODE_ENV === "production" && process.env.BILLING_ENFORCEMENT !== "false");
    const now = new Date();
    let subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      include: { plan: true, reseller: { include: { user: { select: { name: true } } } } },
    });
    if (!subscription) {
      const usage = await this.usage.getBillingUsage(companyId, 159.9);
      return {
        status: "SEM_ASSINATURA",
        manageable: false,
        payableInvoice: null,
        accessRestricted: enforcementEnabled,
        usage,
      };
    }
    // Se uma renovação foi paga mas o webhook não chegou, a revalidação do
    // próprio painel recupera o período antes de aplicar o bloqueio local.
    // Isso cobre recorrência, não só a fatura inicial guardada em
    // `asaasPaymentId`.
    const needsAsaasRenewalCheck = Boolean(
      subscription.asaasSubscriptionId
      && (
        subscription.asaasPaymentId
        || subscription.status === SubscriptionStatus.INADIMPLENTE
        || (subscription.status === SubscriptionStatus.ATIVA
          && subscription.currentPeriodEnd
          && subscription.currentPeriodEnd.getTime() <= now.getTime())
      ),
    );
    if (needsAsaasRenewalCheck) {
      const renewal = await this.reconcileAsaasPaidSubscription(subscription);
      if (renewal?.currentPeriodEnd) {
        subscription = {
          ...subscription,
          status: SubscriptionStatus.ATIVA,
          currentPeriodStart: renewal.currentPeriodStart,
          currentPeriodEnd: renewal.currentPeriodEnd,
          asaasPeriodPaymentId: renewal.paymentId,
          asaasPaymentId: null,
          canceledAt: null,
        };
      }
    }
    // `currentPeriodEnd` é a nossa fonte de verdade para o direito de acesso.
    // Não aguardamos webhook, cache ou uma consulta externa para fechar um
    // período que já terminou. A conciliação Asaas continua útil para registrar
    // o motivo da pendência e cobrir registros antigos sem período consistente.
    const periodExpired = await this.markSubscriptionOverdueIfPeriodExpired(subscription, now);
    if (periodExpired || await this.reconcileAsaasSubscriptionOverdue(subscription, { bypassInterval: true })) {
      subscription = { ...subscription, status: SubscriptionStatus.INADIMPLENTE };
    }
    const trialActive = this.isTrialActive(subscription, now);
    const trialExpired = this.isTrialExpired(subscription, now);
    const monthlyPrice = this.effectiveSubscriptionMonthlyPrice(subscription);
    const paidCurrentPeriod = subscription.status === SubscriptionStatus.ATIVA
      && Boolean(subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() > now.getTime());
    // Um período ATIVO que ainda não terminou já teve a mensalidade quitada.
    // Em inadimplência, ao contrário, a mensalidade vencida continua no saldo.
    // No teste nenhum consumo vira dívida até a pessoa optar por assinar.
    const baseMonthlyPriceDue = (
      (subscription.status === SubscriptionStatus.ATIVA && !paidCurrentPeriod)
      || subscription.status === SubscriptionStatus.INADIMPLENTE
    ) ? monthlyPrice : 0;
    // Um webhook pode falhar depois de o Asaas confirmar o pagamento. A tela
    // reconcilia a própria empresa antes de calcular o extrato, para que um
    // lançamento quitado não fique visível até a próxima rodada do worker.
    if (subscription.asaasSubscriptionId && this.asaas.isConfigured?.()) {
      await this.reconcileAsaasUsagePayments(companyId, { bypassInterval: true });
    }
    const usagePeriod = this.subscriptionUsagePeriod(subscription);
    const usage = usagePeriod
      ? await this.usage.getBillingUsage(companyId, baseMonthlyPriceDue, usagePeriod)
      : await this.usage.getBillingUsage(companyId, baseMonthlyPriceDue);
    const payableInvoice = await this.payableAsaasInvoice(subscription);
    return {
      status: subscription.status,
      provider: subscription.asaasSubscriptionId ? "ASAAS" : subscription.stripeCustomerId ? "STRIPE" : null,
      manageable: Boolean(subscription.stripeCustomerId || subscription.asaasSubscriptionId),
      payableInvoice,
      accessRestricted: trialExpired || (enforcementEnabled && !trialActive && subscription.status !== SubscriptionStatus.ATIVA),
      activationAvailable: trialExpired,
      trial: subscription.trialStartedAt || subscription.trialEndsAt
        ? {
            days: FREE_TRIAL_DAYS,
            startedAt: subscription.trialStartedAt,
            endsAt: subscription.trialEndsAt,
            current: subscription.status === SubscriptionStatus.EM_TESTE,
            active: trialActive,
            expired: trialExpired,
            daysRemaining: subscription.trialEndsAt
              ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
              : 0,
          }
        : null,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      canceledAt: subscription.canceledAt,
      plan: {
        name: subscription.plan.name,
        monthlyPrice,
        currency: subscription.plan.currency,
      },
      referral: subscription.reseller
        ? {
            code: subscription.referralCode,
            resellerName: subscription.reseller.user.name,
            discountEndsAt: subscription.discountEndsAt,
          }
        : null,
      usage,
    };
  }

  async companyPortal(companyId: string) {
    const subscription = await this.db().clientSubscription.findUnique({ where: { companyId } });
    // A assinatura manda no provedor, não a variável de ambiente: quem contratou
    // no Stripe continua sendo gerenciado lá mesmo depois da migração.
    if (subscription?.asaasSubscriptionId) {
      // A interface esconde o botão em dia, mas a rota também precisa ser
      // segura contra chamada direta. Esta consulta revalida o vencimento antes
      // de devolver qualquer link do Asaas.
      const status = await this.companyBillingStatus(companyId);
      if (status.status !== SubscriptionStatus.INADIMPLENTE) {
        throw new BadRequestException("Não há fatura pendente para pagar. Sua assinatura está em dia.");
      }
      return this.companyPortalAsaas({ ...subscription, status: status.status });
    }
    if (!this.stripe) throw new BadRequestException("Stripe ainda não configurado.");
    if (!subscription?.stripeCustomerId) {
      throw new BadRequestException("Esta empresa ainda não possui uma assinatura gerenciável no Stripe.");
    }
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: `${this.publicAppUrl()}/painel/assinatura`,
      });
      return { url: session.url };
    } catch (error) {
      throw new BadGatewayException(
        this.stripeErrorForUser(error, "Não foi possível abrir o portal da assinatura."),
      );
    }
  }

  /**
   * O Asaas não tem portal do cliente como o Stripe. O que o empresário precisa
   * — pagar a cobrança do mês e escolher entre Pix, boleto ou cartão — está na
   * própria fatura, então é para ela que mandamos.
   */
  private async companyPortalAsaas(subscription: any) {
    const emAberto = await this.payableAsaasInvoice(subscription);
    if (!emAberto?.url) {
      throw new BadRequestException(
        "Não há fatura pendente disponível para pagamento no momento.",
      );
    }
    return { url: emAberto.url };
  }

  /**
   * Uma fatura PENDING futura é a próxima mensalidade, não uma dívida atual.
   * O link de pagamento só existe quando há inadimplência e a cobrança venceu
   * ou vence hoje; assim não se oferece uma cobrança nova para quem está em dia
   * nem se força quem já está bloqueado a esperar a virada da meia-noite.
   */
  private async payableAsaasInvoice(subscription: {
    status: SubscriptionStatus;
    asaasSubscriptionId?: string | null;
  }) {
    if (
      subscription.status !== SubscriptionStatus.INADIMPLENTE
      || !subscription.asaasSubscriptionId
      || !this.asaas.isConfigured?.()
    ) return null;
    try {
      const cobrancas = await this.asaas.listSubscriptionPayments(subscription.asaasSubscriptionId);
      const vencida = cobrancas
        .filter((item) => this.isAsaasPaymentPayableNow(item))
        .sort((left, right) => String(left.dueDate ?? "").localeCompare(String(right.dueDate ?? "")))[0];
      if (!vencida?.invoiceUrl) return null;
      return {
        id: vencida.id,
        url: vencida.invoiceUrl,
        dueDate: vencida.dueDate ?? null,
        value: Number(vencida.value ?? 0),
      };
    } catch (error) {
      this.logger.error(
        `Não foi possível localizar a fatura vencida da assinatura ${subscription.asaasSubscriptionId}.`,
        this.stripeErrorForLog(error),
      );
      return null;
    }
  }

  /** Janela da fatura: o ciclo contratado, não o mês do calendário. */
  private subscriptionUsagePeriod(subscription: {
    currentPeriodStart?: Date | string | null;
    currentPeriodEnd?: Date | string | null;
  }) {
    const end = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
    if (!end || Number.isNaN(end.getTime())) return undefined;
    let start = subscription.currentPeriodStart ? new Date(subscription.currentPeriodStart) : null;
    if (!start || Number.isNaN(start.getTime()) || start.getTime() >= end.getTime()) {
      // Registros legados têm apenas o fim. Inferir um mês evita um backfill
      // mutável em produção e mantém o extrato no ciclo correto.
      start = new Date(end);
      start.setMonth(start.getMonth() - 1);
    }
    return { periodStart: start, periodEnd: end };
  }

  /**
   * Histórico de cobranças para a tela de assinatura. Cada linha traz o link da
   * fatura, que é onde o cliente troca a forma de pagamento — no Asaas o meio é
   * escolhido na hora de pagar, não guardado antes.
   */
  async companyInvoices(companyId: string) {
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      select: { asaasSubscriptionId: true, stripeCustomerId: true, status: true },
    });
    if (subscription?.asaasSubscriptionId) {
      const cobrancas = await this.asaas
        .listSubscriptionPayments(subscription.asaasSubscriptionId)
        .catch((error: unknown) => {
          this.logger.error(`Não foi possível listar cobranças da empresa ${companyId}.`, this.stripeErrorForLog(error));
          return [];
        });
      return {
        provider: "ASAAS" as const,
        invoices: cobrancas.map((item) => ({
          id: item.id,
          value: Number(item.value ?? 0),
          dueDate: item.dueDate,
          status: item.status,
          paid: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(item.status),
          // A tabela é histórico. Só a fatura que de fato regulariza uma
          // inadimplência ganha ação de pagamento; a próxima aparece apenas
          // como previsão para não induzir uma cobrança antecipada.
          payable: subscription.status === SubscriptionStatus.INADIMPLENTE && this.isAsaasPaymentPayableNow(item),
          url: item.invoiceUrl ?? null,
        })),
      };
    }
    if (!this.stripe || !subscription?.stripeCustomerId) return { provider: null, invoices: [] };
    const faturas = await this.stripe.invoices
      .list({ customer: subscription.stripeCustomerId, limit: 12 })
      .catch(() => ({ data: [] as Stripe.Invoice[] }));
    return {
      provider: "STRIPE" as const,
      invoices: faturas.data.map((item) => ({
        id: item.id,
        value: (item.total ?? 0) / 100,
        dueDate: item.created ? new Date(item.created * 1000).toISOString().slice(0, 10) : null,
        status: item.status ?? "",
        paid: item.status === "paid",
        payable: item.status !== "paid",
        url: item.hosted_invoice_url ?? null,
      })),
    };
  }

  /**
   * Cancelamento pedido pelo próprio empresário. O acesso continua até o fim do
   * período já pago: cancelar não devolve dinheiro, e cortar na hora seria tirar
   * algo que ele pagou.
   */
  async cancelCompanySubscription(companyId: string) {
    const subscription = await this.db().clientSubscription.findUnique({ where: { companyId } });
    if (!subscription) throw new NotFoundException("Assinatura não encontrada para esta empresa.");
    if (subscription.status === SubscriptionStatus.CANCELADA) {
      return { status: SubscriptionStatus.CANCELADA, alreadyCanceled: true };
    }

    if (subscription.asaasSubscriptionId) {
      await this.asaas.cancelSubscription(subscription.asaasSubscriptionId);
    } else if (subscription.stripeSubscriptionId && this.stripe) {
      try {
        await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true });
      } catch (error) {
        throw new BadGatewayException(this.stripeErrorForUser(error, "Não foi possível cancelar a assinatura."));
      }
      // Na Stripe o corte acontece no fim do período; o status muda quando o
      // webhook avisar. Aqui só registramos o pedido.
      await this.db().clientSubscription.update({
        where: { id: subscription.id },
        data: { canceledAt: new Date() },
      });
      return { status: subscription.status, endsAt: subscription.currentPeriodEnd, scheduled: true };
    } else {
      throw new BadRequestException("Esta empresa não possui uma assinatura ativa para cancelar.");
    }

    // No Asaas, cancelar a assinatura só impede cobranças futuras; o acesso
    // segue até o fim do período pago.
    const fimDoPeriodo = subscription.currentPeriodEnd ?? null;
    await this.db().clientSubscription.update({
      where: { id: subscription.id },
      data: {
        canceledAt: new Date(),
        // Sem período pago em curso não há o que preservar.
        ...(fimDoPeriodo && fimDoPeriodo > new Date() ? {} : { status: SubscriptionStatus.CANCELADA }),
      },
    });
    this.logger.log(`Assinatura ${subscription.id} cancelada a pedido da empresa ${companyId}.`);
    return { status: SubscriptionStatus.CANCELADA, endsAt: fimDoPeriodo, scheduled: Boolean(fimDoPeriodo && fimDoPeriodo > new Date()) };
  }

  /**
   * Depois do fim do teste, o próprio administrador abre uma nova sessão de
   * checkout. Não reutilizamos consumo nem período do teste: ele foi um custo
   * assumido pela ChegowIA e a assinatura paga começa limpa a partir daqui.
   */
  /**
   * Provedor que atende contratações novas. Assinatura já criada no Stripe
   * continua nele até terminar — trocar o provedor de quem já paga exigiria
   * refazer o meio de pagamento do cliente sem que ele tenha pedido.
   */
  private billingProvider(): "STRIPE" | "ASAAS" {
    return process.env.BILLING_PROVIDER === "ASAAS" && this.asaas.isConfigured() ? "ASAAS" : "STRIPE";
  }

  /**
   * Cliente do Asaas correspondente à empresa. O Asaas exige CPF/CNPJ para
   * emitir cobrança, então uma empresa sem documento cadastrado não consegue
   * ativar — e é melhor dizer isso do que falhar dentro da API deles.
   */
  private async ensureAsaasCustomer(subscription: any, admin: { email: string; name?: string }) {
    if (subscription.asaasCustomerId) return subscription.asaasCustomerId;

    const company = await this.db().company.findUnique({
      where: { id: subscription.companyId },
      select: { name: true, cnpj: true, phone: true },
    });
    const document = (company?.cnpj ?? "").replace(/\D/g, "");
    if (!document) {
      this.logger.error(
        `Ativação bloqueada: a empresa ${subscription.companyId} não tem CNPJ, exigido pelo Asaas para emitir cobrança.`,
      );
      throw new BadRequestException(
        "Falta o CNPJ da empresa para emitir a cobrança. Preencha em Configurações e tente de novo.",
      );
    }

    const customer = await this.asaas.createCustomer({
      name: company?.name ?? admin.name ?? "Cliente ChegowIA",
      email: admin.email,
      cpfCnpj: document,
      phone: company?.phone ?? null,
      externalReference: subscription.companyId,
    });
    await this.db().clientSubscription.update({
      where: { id: subscription.id },
      data: { asaasCustomerId: customer.id },
    });
    return customer.id;
  }

  /**
   * Ativação pós-teste pelo Asaas: cria a assinatura mensal com vencimento hoje
   * e devolve a fatura para pagamento. A cobrança em aberto é guardada para o
   * empresário reabrir o mesmo link em vez de gerar uma segunda a cada clique.
   */
  private async companyCheckoutAsaas(subscription: any, admin: { email: string; name?: string }) {
    if (subscription.asaasPaymentId) {
      try {
        const existing = await this.asaas.getPayment(subscription.asaasPaymentId);
        // Já paga: o webhook não chegou ou falhou. Ativar aqui é o que impede o
        // pior caso desta tela — o empresário clicar de novo e pagar duas vezes.
        if (ASAAS_PAID_STATUSES.includes(existing.status)) {
          this.logger.warn(
            `Cobrança ${existing.id} da empresa ${subscription.companyId} estava paga sem ativação; liberando pela conciliação.`,
          );
          await this.activateFromAsaasPayment({
            id: existing.id,
            value: existing.value,
            status: existing.status,
            subscription: existing.subscription ?? subscription.asaasSubscriptionId,
            customer: existing.customer,
          }, { fundsReceived: this.asaasPaymentHasSettledFunds(existing) });
          return { activated: true, reused: true };
        }
        if (existing.invoiceUrl) {
          return { url: existing.invoiceUrl, reused: true };
        }
      } catch {
        // Cobrança apagada no painel do Asaas: seguimos e criamos outra.
      }
    }

    const customerId = await this.ensureAsaasCustomer(subscription, admin);
    const monthlyPrice = this.effectiveSubscriptionMonthlyPrice(subscription);
    // `dueDate` do Asaas é data civil no Brasil, não instante UTC. Depois das
    // 21h BRT, `toISOString()` já é amanhã e criaria uma fatura futura sem o
    // empresário ter pedido isso.
    const hoje = this.saoPauloCalendarDate();

    const created = await this.asaas.createSubscription({
      customer: customerId,
      value: monthlyPrice,
      nextDueDate: hoje,
      description: `ChegowIA — ${subscription.plan.name}`,
      externalReference: subscription.id,
    });

    // A assinatura já nasce com a primeira cobrança; é dela que sai o link.
    const payments = await this.asaas.listSubscriptionPayments(created.id);
    const first = payments[0];
    if (!first?.invoiceUrl) {
      throw new BadGatewayException("O Asaas não devolveu o link de pagamento da ativação.");
    }

    await this.db().clientSubscription.update({
      where: { id: subscription.id },
      data: { asaasSubscriptionId: created.id, asaasPaymentId: first.id },
    });

    // Consumo faturável acumulado entra nesta mesma cobrança. O valor da
    // assinatura fica intocado, senão o acréscimo se repetiria todo mês.
    const cobrancaFinal = await this.addPendingUsageToPayment(subscription.companyId, first);
    return { url: cobrancaFinal.invoiceUrl ?? first.invoiceUrl, reused: false };
  }

  async companyCheckout(companyId: string) {
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      include: {
        plan: true,
        reseller: true,
        company: { select: { name: true } },
      },
    });
    if (!subscription) throw new NotFoundException("Assinatura não encontrada para esta empresa.");
    if (!this.isTrialExpired(subscription)) {
      throw new BadRequestException("A ativação paga fica disponível quando os 7 dias de teste terminarem.");
    }
    const admin = await this.db().user.findFirst({
      where: { companyId, role: Role.ADMIN, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { email: true, name: true },
    });
    if (!admin) {
      // Quem lê esta tela é o empresário, que não tem acesso ao painel da
      // plataforma nem como resolver isso sozinho.
      this.logger.error(
        `Ativação bloqueada: a empresa ${companyId} não tem usuário ADMIN ativo, e é o e-mail dele que identifica o cliente na cobrança.`,
      );
      throw new BadRequestException(
        "Não conseguimos identificar o responsável pela conta desta empresa. Fale com o suporte da ChegowIA para liberar a ativação.",
      );
    }

    if (this.billingProvider() === "ASAAS") {
      return this.companyCheckoutAsaas(subscription, admin);
    }

    if (!this.stripe) {
      throw new BadRequestException("A cobrança ainda está sendo configurada. Tente novamente em alguns instantes.");
    }
    const monthlyPrice = this.effectiveSubscriptionMonthlyPrice(subscription);
    const canUseStoredStripePrice = Boolean(
      subscription.plan.stripePriceId
      && Math.round(monthlyPrice * 100) === Math.round(Number(subscription.plan.monthlyPrice) * 100),
    );
    if (canUseStoredStripePrice) {
      await this.assertStripePrice(subscription.plan.stripePriceId!, {
        monthlyPrice,
        currency: subscription.plan.currency,
      });
    }

    if (subscription.stripeCheckoutSessionId) {
      try {
        const existing = await this.stripe.checkout.sessions.retrieve(subscription.stripeCheckoutSessionId);
        if (existing.status === "open" && existing.url) {
          return { url: existing.url, reused: true };
        }
      } catch (error) {
        if (!this.isMissingStripeResource(error)) throw error;
      }
    }

    // O admin já foi resolvido acima: o e-mail dele vira o cliente na cobrança,
    // e não pode cair no usuário logado — um superadmin gerando a fatura pelo
    // contexto assumido colocaria o endereço da plataforma na conta do cliente.
    if (!admin) {
      // Quem lê esta tela é o empresário, que não tem acesso ao painel da
      // plataforma nem como resolver isso sozinho. O detalhe acionável vai para
      // o log, onde a equipe consegue agir.
      this.logger.error(
        `Ativação bloqueada: a empresa ${companyId} não tem usuário ADMIN ativo, e é o e-mail dele que vira o cliente no Stripe.`,
      );
      throw new BadRequestException(
        "Não conseguimos identificar o responsável pela conta desta empresa. Fale com o suporte da ChegowIA para liberar a ativação.",
      );
    }

    /**
     * A chave de idempotência precisa mudar sempre que os parâmetros mudarem: a
     * Stripe recusa a mesma chave com corpo diferente. Derivá-la de `updatedAt`
     * não bastava — preço alterado fora do Prisma (correção manual, migração de
     * dados) mantinha o carimbo antigo e travava a ativação com erro que não
     * dizia isso. O resumo abaixo cobre o que de fato compõe a sessão.
     */
    const activationFingerprint = createHash("sha256")
      .update([
        Math.round(monthlyPrice * 100),
        subscription.plan.currency,
        canUseStoredStripePrice ? subscription.plan.stripePriceId : "inline",
        subscription.stripeCustomerId ?? admin.email,
        subscription.resellerId ?? "",
      ].join("|"))
      .digest("hex")
      .slice(0, 16);

    const discounts: Stripe.Checkout.SessionCreateParams.Discount[] = [];
    if (subscription.resellerId) discounts.push({ coupon: await this.referralCouponId() });
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      locale: "pt-BR",
      ...(subscription.stripeCustomerId ? { customer: subscription.stripeCustomerId } : { customer_email: admin.email }),
      line_items: [canUseStoredStripePrice
        ? { price: subscription.plan.stripePriceId!, quantity: 1 }
        : {
          price_data: {
            currency: subscription.plan.currency,
            unit_amount: Math.round(monthlyPrice * 100),
            recurring: { interval: "month" },
            product_data: { name: `ChegowIA — ${subscription.plan.name}` },
          },
          quantity: 1,
        }],
      // Só enviamos `discounts` quando há cupom: a Stripe recusa a lista vazia
      // em vez de tratá-la como ausência de desconto.
      ...(discounts.length ? { discounts } : {}),
      success_url: `${this.publicAppUrl()}/contratar/sucesso?ativacao=1`,
      cancel_url: `${this.publicAppUrl()}/painel/assinatura?pagamento=cancelado`,
      metadata: {
        companyId,
        subscriptionId: subscription.id,
        activation: "trial",
      },
      subscription_data: {
        metadata: {
          companyId,
          subscriptionId: subscription.id,
          activation: "trial",
          resellerId: subscription.resellerId ?? "",
          planId: subscription.planId,
        },
      },
    }, { idempotencyKey: `trial-activation-${subscription.id}-${activationFingerprint}` });
    if (!session.url) throw new BadGatewayException("A Stripe não retornou o link para pagamento da ativação.");
    await this.db().clientSubscription.update({
      where: { id: subscription.id },
      data: { stripeCheckoutSessionId: session.id },
    });
    return { url: session.url, reused: false };
  }

  listClientApplications() {
    return this.db().clientApplication.findMany({ orderBy: { createdAt: "desc" }, include: { plan: true, reseller: { include: { user: { select: { name: true } } } } } });
  }

  async operationalStatus() {
    await this.releaseMatureCommissions();
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const [
      failedEvents,
      staleEvents,
      failedPayouts,
      stuckPayouts,
      incompleteConnect,
      delinquentSubscriptions,
    ] = await Promise.all([
      this.db().stripeEvent.findMany({
        where: { status: StripeEventStatus.FALHOU },
        select: {
          id: true,
          type: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }),
      this.db().stripeEvent.count({
        where: {
          status: { in: [StripeEventStatus.PENDENTE, StripeEventStatus.PROCESSANDO] },
          createdAt: { lt: staleBefore },
        },
      }),
      this.db().payoutBatch.count({ where: { status: PayoutBatchStatus.FALHOU } }),
      this.db().payoutBatch.count({
        where: {
          status: PayoutBatchStatus.PROCESSANDO,
          createdAt: { lt: staleBefore },
        },
      }),
      this.db().resellerProfile.count({
        where: { stripeAccountId: { not: null }, stripeOnboardingOk: false, isActive: true },
      }),
      this.db().clientSubscription.count({ where: { status: SubscriptionStatus.INADIMPLENTE } }),
    ]);
    return {
      healthy: failedEvents.length === 0 && staleEvents === 0 && stuckPayouts === 0,
      counts: {
        failedStripeEvents: failedEvents.length,
        staleStripeEvents: staleEvents,
        failedPayouts,
        stuckPayouts,
        incompleteConnect,
        delinquentSubscriptions,
      },
      failedEvents,
      checkedAt: new Date(),
    };
  }

  async retryStripeEvent(id: string) {
    const event = await this.db().stripeEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException("Evento Stripe não encontrado.");
    if (event.status === StripeEventStatus.PROCESSADO) {
      return { queued: false, message: "Este evento já foi processado." };
    }
    await this.db().stripeEvent.update({
      where: { id },
      data: {
        status: StripeEventStatus.PENDENTE,
        attempts: 0,
        lastError: null,
        processedAt: null,
      },
    });
    queueMicrotask(() => void this.processStripeEvent(id));
    return { queued: true };
  }

  async approveClientApplication(id: string) {
    const application = await this.db().clientApplication.findUnique({ where: { id }, include: { plan: true } });
    if (!application) throw new NotFoundException("Cadastro não encontrado.");
    await this.ensureClientIdentityAvailable(application);
    await this.db().clientApplication.update({ where: { id }, data: { status: ApplicationStatus.APROVADA } });
    return this.startTrial(id);
  }

  private async evaluateClient(application: any) {
    let analysis: any;
    try {
      // Custo da plataforma: esta análise é do processo comercial da ChegowIA,
      // anterior à existência da empresa. Não há a quem atribuir consumo.
      const result = await this.ai.chat([
        {
          role: "system",
          content:
            "Valide cadastro comercial de uma empresa para contratar SaaS. Confira completude, coerência entre atividade e uso informado e sinais explícitos de fraude. Não use características pessoais protegidas. Responda JSON puro: {\"score\":0-100,\"decision\":\"APPROVE\"|\"HUMAN\",\"feedback\":\"texto curto\",\"checks\":[\"\"]}. Aprove cadastros coerentes e completos; dúvida vai para humano.",
        },
        { role: "user", content: `Empresa: ${application.companyName}\nCidade/UF: ${application.city}/${application.state}\nRamo: ${application.businessType}\nOperação: ${application.operationDetails}` },
      ]);
      analysis = JSON.parse((result.content ?? "").replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      analysis = { score: null, decision: "HUMAN", feedback: "Validação automática indisponível; cadastro enviado para revisão humana." };
    }
    if (analysis.decision !== "APPROVE" || Number(analysis.score) < 70) {
      await this.db().clientApplication.update({ where: { id: application.id }, data: { status: ApplicationStatus.REVISAO_HUMANA, aiScore: analysis.score, aiFeedback: analysis.feedback, aiAnalysis: analysis } });
      return { applicationId: application.id, status: ApplicationStatus.REVISAO_HUMANA, feedback: analysis.feedback };
    }
    await this.db().clientApplication.update({ where: { id: application.id }, data: { status: ApplicationStatus.APROVADA, aiScore: analysis.score, aiFeedback: analysis.feedback, aiAnalysis: analysis } });
    const trial = await this.startTrial(application.id);
    return { applicationId: application.id, status: ApplicationStatus.APROVADA, ...trial };
  }

  /**
   * Provisiona a empresa assim que o cadastro é aprovado. A senha já foi
   * escolhida pelo empresário, mas o login continua protegido pela confirmação
   * de e-mail enviada abaixo. Não há cliente nem assinatura Stripe neste ponto.
   */
  async startTrial(applicationId: string) {
    const application = await this.db().clientApplication.findUnique({
      where: { id: applicationId },
      include: { plan: true, reseller: true },
    });
    if (!application || application.status !== ApplicationStatus.APROVADA) throw new BadRequestException("Cadastro ainda não aprovado.");
    if (application.companyId) {
      const existing = await this.db().clientSubscription.findUnique({ where: { companyId: application.companyId } });
      if (existing) {
        return {
          trialStarted: existing.status === SubscriptionStatus.EM_TESTE,
          companyId: application.companyId,
          trialEndsAt: existing.trialEndsAt,
          trialDays: FREE_TRIAL_DAYS,
          message: existing.status === SubscriptionStatus.EM_TESTE
            ? "Seu teste gratuito já está ativo. Confirme o e-mail para entrar no painel."
            : "Esta empresa já possui uma assinatura ativa.",
        };
      }
    }
    await this.ensureClientIdentityAvailable(application);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const slug = await this.uniqueCompanySlug(application.tradeName || application.companyName);
    const admin = await this.db().$transaction(async (tx: any) => {
      const company = await tx.company.create({
        data: {
          name: application.tradeName || application.companyName,
          slug,
          cnpj: application.document,
          phone: application.phone,
          city: application.city,
          state: application.state,
          // Uma candidatura antiga marcada como teste não é promovida
          // silenciosamente ao provisionar. A revisão é explícita.
          isTestOnly: Boolean(application.isTestOnly),
          settings: { create: { plan: application.plan.slug } },
        },
      });
      await tx.identityDocument.create({
        data: { value: application.document, ownerType: "COMPANY", ownerId: company.id },
      });
      const createdAdmin = await tx.user.create({
        data: {
          name: application.responsibleName,
          email: application.email,
          passwordHash: application.passwordHash,
          role: Role.ADMIN,
          companyId: company.id,
          termsAcceptedAt: application.termsAcceptedAt,
          privacyAcceptedAt: application.privacyAcceptedAt,
          employeeProfile: { create: { companyId: company.id, position: "Administrador" } },
        },
      });
      await tx.clientSubscription.create({
        data: {
          companyId: company.id,
          planId: application.planId,
          monthlyPriceSnapshot: application.monthlyPriceSnapshot
            ?? (application.isTestOnly ? 0.5 : this.effectivePlanMonthlyPrice(application.plan)),
          resellerId: application.resellerId,
          status: SubscriptionStatus.EM_TESTE,
          trialStartedAt: now,
          trialEndsAt,
          referralCode: application.resellerCode,
          referralLockedAt: application.resellerId ? now : null,
        },
      });
      await tx.clientApplication.update({ where: { id: application.id }, data: { companyId: company.id, stripeSessionId: null } });
      if (application.sourceLeadId) {
        await tx.salesLead.updateMany({
          where: {
            id: application.sourceLeadId,
            resellerId: application.resellerId,
            status: { in: [LeadStatus.EM_ATENDIMENTO, LeadStatus.PROPOSTA] },
          },
          data: { status: LeadStatus.PROPOSTA },
        });
      }
      return { id: createdAdmin.id, companyId: company.id };
    });
    await this.auth.sendVerificationForUser(admin.id);
    return {
      trialStarted: true,
      companyId: admin.companyId,
      trialEndsAt,
      trialDays: FREE_TRIAL_DAYS,
      message: "Seu teste gratuito de 7 dias começou. Confirme seu e-mail para entrar e usar todos os recursos.",
    };
  }

  /** Compatibilidade com links antigos: agora eles iniciam o teste, sem cobrança antecipada. */
  async checkout(applicationId: string) {
    return this.startTrial(applicationId);
  }

  private async completeTrialActivation(session: Stripe.Checkout.Session, fallbackCompanyId?: string) {
    const companyId = session.metadata?.companyId ?? fallbackCompanyId;
    if (!companyId) return;
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      include: { reseller: true },
    });
    if (!subscription) return;
    const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    let currentPeriodStart: Date | null = null;
    let currentPeriodEnd: Date | null = null;
    if (this.stripe && stripeSubscriptionId) {
      try {
        const remoteSubscription = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
        currentPeriodStart = this.subscriptionPeriodStart(remoteSubscription);
        currentPeriodEnd = this.subscriptionPeriodEnd(remoteSubscription);
      } catch (error) {
        this.logger.warn(`Não foi possível consultar o período da nova assinatura ${stripeSubscriptionId}: ${this.stripeErrorForLog(error)}`);
      }
    }
    const activationAt = new Date();
    await this.db().$transaction(async (tx: any) => {
      await tx.clientSubscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ATIVA,
          stripeCustomerId: stripeCustomerId ?? subscription.stripeCustomerId,
          stripeSubscriptionId: stripeSubscriptionId ?? subscription.stripeSubscriptionId,
          stripeCheckoutSessionId: null,
          currentPeriodStart,
          currentPeriodEnd,
          canceledAt: null,
          // O desconto por indicação começa com a assinatura paga, não no teste.
          discountEndsAt: subscription.resellerId && !subscription.discountEndsAt
            ? new Date(activationAt.getFullYear(), activationAt.getMonth() + 3, activationAt.getDate())
            : subscription.discountEndsAt,
        },
      });
      const application = await tx.clientApplication.findFirst({
        where: { companyId },
        select: { sourceLeadId: true, resellerId: true },
        orderBy: { createdAt: "desc" },
      });
      if (application?.sourceLeadId) {
        await tx.salesLead.updateMany({
          where: { id: application.sourceLeadId, resellerId: application.resellerId },
          data: { status: LeadStatus.CONVERTIDO, convertedAt: activationAt },
        });
      }
    });
    await this.recordCommissionForSubscription(stripeSubscriptionId);
  }

  async handleWebhook(
    signature: string | undefined,
    rawBody: Buffer,
    source: "platform" | "connect" = "platform",
  ) {
    const webhookSecret = source === "connect"
      ? process.env.STRIPE_CONNECT_WEBHOOK_SECRET
      : process.env.STRIPE_WEBHOOK_SECRET;
    if (!this.stripe || !webhookSecret) {
      throw new BadRequestException(
        source === "connect"
          ? "Webhook Stripe Connect não configurado."
          : "Webhook Stripe não configurado.",
      );
    }
    if (!signature) throw new BadRequestException("Assinatura Stripe ausente.");
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    await this.db().stripeEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        type: event.type,
        payload: JSON.parse(JSON.stringify(event)),
        status: StripeEventStatus.PENDENTE,
      },
      update: {},
    });
    queueMicrotask(() => void this.processStripeEvent(event.id));
    return { received: true, duplicateSafe: true };
  }

  private async completeCheckout(session: Stripe.Checkout.Session) {
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
    if (session.metadata?.companyId) {
      await this.completeTrialActivation(session);
      return;
    }
    const applicationId = session.metadata?.applicationId;
    if (!applicationId) return;
    const application = await this.db().clientApplication.findUnique({ where: { id: applicationId }, include: { plan: true } });
    if (!application) return;
    const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (application.companyId) {
      const admin = await this.db().user.findFirst({
        where: { companyId: application.companyId, role: Role.ADMIN },
        orderBy: { createdAt: "asc" },
      });
      if (admin) await this.auth.sendVerificationForUser(admin.id);
      // Sessões antigas podem terminar depois que o cadastro migrou para o
      // teste. Nesse caso, ativa a mesma empresa em vez de criar uma segunda.
      const existingSubscription = await this.db().clientSubscription.findUnique({
        where: { companyId: application.companyId },
        select: { status: true },
      });
      if (existingSubscription?.status === SubscriptionStatus.EM_TESTE) {
        await this.completeTrialActivation(session, application.companyId);
      } else {
        // Retry de checkout legado: a empresa já nasceu como paga. Mantemos a
        // conciliação de comissão sem exigir os novos campos do teste.
        await this.recordCommissionForSubscription(stripeSubscriptionId);
      }
      return;
    }
    await this.ensureClientIdentityAvailable(application);
    const slug = await this.uniqueCompanySlug(application.tradeName || application.companyName);
    const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const discountEndsAt = application.resellerId ? new Date(new Date().setMonth(new Date().getMonth() + 3)) : null;
    const admin = await this.db().$transaction(async (tx: any) => {
      const company = await tx.company.create({
        data: {
          name: application.tradeName || application.companyName,
          slug,
          cnpj: application.document,
          phone: application.phone,
          city: application.city,
          state: application.state,
          // Preserva a marcação histórica de teste até decisão explícita.
          isTestOnly: Boolean(application.isTestOnly),
          settings: { create: { plan: application.plan.slug } },
        },
      });
      await tx.identityDocument.create({
        data: { value: application.document, ownerType: "COMPANY", ownerId: company.id },
      });
      const createdAdmin = await tx.user.create({
        data: {
          name: application.responsibleName,
          email: application.email,
          passwordHash: application.passwordHash,
          role: Role.ADMIN,
          companyId: company.id,
          termsAcceptedAt: application.termsAcceptedAt,
          privacyAcceptedAt: application.privacyAcceptedAt,
          employeeProfile: { create: { companyId: company.id, position: "Administrador" } },
        },
      });
      await tx.clientSubscription.create({
        data: {
          companyId: company.id,
          planId: application.planId,
          monthlyPriceSnapshot: application.monthlyPriceSnapshot
            ?? (application.isTestOnly ? 0.5 : this.effectivePlanMonthlyPrice(application.plan)),
          resellerId: application.resellerId,
          status: SubscriptionStatus.ATIVA, stripeCustomerId, stripeSubscriptionId,
          referralCode: application.resellerCode, referralLockedAt: application.resellerId ? new Date() : null, discountEndsAt,
        },
      });
      await tx.clientApplication.update({ where: { id: application.id }, data: { companyId: company.id } });
      if (application.sourceLeadId) {
        await tx.salesLead.updateMany({
          where: { id: application.sourceLeadId, resellerId: application.resellerId },
          data: { status: LeadStatus.CONVERTIDO, convertedAt: new Date() },
        });
      }
      return createdAdmin;
    });
    await this.auth.sendVerificationForUser(admin.id);
    await this.recordCommissionForSubscription(stripeSubscriptionId);
  }

  /**
   * Busca a última fatura paga da assinatura e lança a comissão. Separado de
   * `completeCheckout` porque os dois caminhos — provisionamento novo e retry
   * sobre empresa já criada — precisam executá-lo.
   */
  private async recordCommissionForSubscription(stripeSubscriptionId?: string) {
    if (!this.stripe || !stripeSubscriptionId) return;
    const stripeSubscription = await this.stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ["latest_invoice"] });
    const latestInvoice = stripeSubscription.latest_invoice;
    if (latestInvoice && typeof latestInvoice !== "string" && latestInvoice.status === "paid") {
      await this.recordCommission(latestInvoice);
    }
  }

  private async ensureClientIdentityAvailable(application: { email: string; document: string }) {
    const [emailUser, documentUser, documentCompany] = await Promise.all([
      this.db().user.findUnique({ where: { email: application.email } }),
      this.db().user.findUnique({ where: { document: application.document } }),
      this.db().company.findUnique({ where: { cnpj: application.document } }),
    ]);
    if (emailUser) throw new ConflictException("Este e-mail já possui uma conta ativa.");
    if (documentUser || documentCompany) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
  }

  private async recordCommission(invoice: Stripe.Invoice) {
    const stripeSubscriptionId = this.subscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) return;
    const subscription = await this.db().clientSubscription.findUnique({
      where: { stripeSubscriptionId },
      include: { reseller: true, plan: true },
    });
    if (!subscription) return;
    await this.db().clientSubscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.ATIVA } });
    if (!subscription.resellerId || !subscription.reseller?.isActive) return;
    if (!this.hasCompletedCommissionTrial(subscription)) return;
    const gross = this.commissionableMonthlyAmount(subscription, Number(invoice.amount_paid ?? 0) / 100);
    if (!gross) return;
    const rate = this.resellerCommissionRate(subscription.reseller);
    const holdDays = Math.max(
      0,
      Number(process.env.STRIPE_COMMISSION_HOLD_DAYS ?? 7),
    );
    const availableAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
    await this.db().commissionLedger.upsert({
      where: { stripeInvoiceId: invoice.id },
      create: {
        resellerId: subscription.resellerId, subscriptionId: subscription.id, stripeInvoiceId: invoice.id,
        grossAmount: gross, commissionRate: rate, commissionAmount: Math.round(gross * rate * 100) / 100,
        currency: invoice.currency,
        status: holdDays === 0 ? CommissionStatus.DISPONIVEL : CommissionStatus.PENDENTE,
        availableAt,
      },
      update: {},
    });
  }

  private async updateSubscriptionFromInvoice(invoice: Stripe.Invoice, status: SubscriptionStatus) {
    const id = this.subscriptionIdFromInvoice(invoice);
    if (id) await this.db().clientSubscription.updateMany({ where: { stripeSubscriptionId: id }, data: { status } });
  }

  private async recordRefund(charge: Stripe.Charge) {
    const invoiceId = typeof (charge as any).invoice === "string" ? (charge as any).invoice : (charge as any).invoice?.id;
    if (!invoiceId || !charge.amount_refunded) return;
    const original = await this.db().commissionLedger.findUnique({ where: { stripeInvoiceId: invoiceId } });
    if (!original) return;
    const rate = Number(original.commissionRate);
    const refunded = Number(charge.amount_refunded) / 100;
    // A fatura pode conter consumo variável que nunca compôs a comissão.
    const commissionableRefund = Math.min(Math.max(0, Number(original.grossAmount)), refunded);
    if (!commissionableRefund) return;
    const reversalId = `${invoiceId}:refund:${charge.id}`;
    if (
      original.status === CommissionStatus.PAGA
      || original.status === CommissionStatus.PROCESSANDO
    ) {
      await this.db().commissionLedger.upsert({
        where: { stripeInvoiceId: reversalId },
        create: {
          resellerId: original.resellerId,
          subscriptionId: original.subscriptionId,
          stripeInvoiceId: reversalId,
          grossAmount: -commissionableRefund,
          commissionRate: rate,
          commissionAmount: -(Math.round(commissionableRefund * rate * 100) / 100),
          currency: charge.currency,
          status: CommissionStatus.DISPONIVEL,
          availableAt: new Date(),
        },
        update: {
          grossAmount: -commissionableRefund,
          commissionAmount: -(Math.round(commissionableRefund * rate * 100) / 100),
        },
      });
    } else {
      const remainingCommission = Math.max(0, Math.round((Number(original.grossAmount) - commissionableRefund) * rate * 100) / 100);
      await this.db().commissionLedger.update({
        where: { id: original.id },
        data: {
          commissionAmount: remainingCommission,
          ...(charge.refunded ? { status: CommissionStatus.ESTORNADA } : {}),
        },
      });
    }
  }

  private async uniqueCompanySlug(name: string) {
    const root = slugify(name) || "empresa";
    let value = root;
    let suffix = 1;
    while (await this.db().company.findUnique({ where: { slug: value } })) value = `${root}-${++suffix}`;
    return value;
  }

  private async processPendingStripeEvents() {
    await this.db().stripeEvent.updateMany({
      where: {
        status: StripeEventStatus.PROCESSANDO,
        updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
      },
      data: {
        status: StripeEventStatus.FALHOU,
        lastError: "Processamento interrompido; evento recolocado na fila.",
      },
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível recuperar eventos Stripe interrompidos.", this.stripeErrorForLog(error));
    });

    const pending = await this.db().stripeEvent.findMany({
      where: {
        status: { in: [StripeEventStatus.PENDENTE, StripeEventStatus.FALHOU] },
        attempts: { lt: MAX_STRIPE_EVENT_ATTEMPTS },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true },
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível consultar a fila de eventos Stripe.", this.stripeErrorForLog(error));
      return [];
    });
    for (const item of pending) await this.processStripeEvent(item.id);
  }

  private async processBackgroundJobs() {
    if (this.backgroundJobsRunning) return;
    this.backgroundJobsRunning = true;
    try {
      await this.processPendingStripeEvents();
      // Reserva pós-crédito opcional: a liberação não depende de o revendedor
      // abrir o painel, e a notificação sai só depois de o saldo estar sacável.
      await this.releaseMatureCommissions();
      await this.processPendingPayouts();
      // Recupere primeiro uma renovação Asaas já paga cujo webhook se perdeu.
      // Só depois disso a data local pode transformar o acesso em inadimplência.
      if (this.asaas.isConfigured()) {
        await this.reconcilePendingAsaasPayments();
        await this.reconcilePaidAsaasRenewals();
        await this.reconcilePendingAsaasCommissions();
      }
      // O fim do período é suficiente para interromper o acesso, mesmo se o
      // provedor externo estiver fora, com webhook atrasado ou sem configuração
      // temporariamente. Cada provedor ainda concilia pagamento em seguida.
      await this.reconcileExpiredSubscriptionPeriods();
      // O provedor global decide novas contratações, não o provedor de cada
      // assinatura existente. Durante uma migração podemos ter assinaturas dos
      // dois lados; deixar de conciliar uma delas porque o padrão mudou abre
      // justamente a brecha de cobrança que esta rotina existe para fechar.
      if (this.asaas.isConfigured()) {
        await this.reconcileOverdueAsaasPayments();
        await this.reconcileOrphanUsage();
        await this.syncVariableUsageToAsaas();
      }
      if (this.stripe) {
        await this.syncVariableUsageToStripe();
      }
      await this.alertDeadLetters();
    } catch (error) {
      // Chamado por `setInterval` sem quem espere a promessa: uma exceção que
      // escapasse daqui viraria unhandled rejection e derrubaria o processo do
      // worker inteiro por causa de uma rodada ruim.
      this.logger.error("Falha na rodada de jobs em segundo plano.", this.stripeErrorForLog(error));
    } finally {
      this.backgroundJobsRunning = false;
    }
  }

  /**
   * Avisa a operação sobre o que morreu na fila.
   *
   * Um evento Stripe que esgota as tentativas simplesmente deixa de aparecer em
   * `processPendingStripeEvents` — a fatura foi paga, o acesso não foi liberado
   * e nada é registrado além de uma linha de log. O mesmo vale para o lote de
   * repasse encerrado por esgotamento. Só existia a tela `/super-admin/operacao`,
   * que é consulta manual: dava para passar dias sem ninguém olhar.
   *
   * O aviso é reivindicado com `updateMany` condicional em `alertedAt`, o mesmo
   * padrão usado para reivindicar evento e lote, então o worker rodando a cada
   * 5 segundos — ou duas réplicas — enviam exatamente um e-mail por item.
   */
  private async alertDeadLetters() {
    const eventos = await this.db().stripeEvent.findMany({
      where: {
        status: StripeEventStatus.FALHOU,
        attempts: { gte: MAX_STRIPE_EVENT_ATTEMPTS },
        alertedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, type: true, attempts: true, lastError: true },
    }).catch(() => []);

    for (const evento of eventos) {
      const claimed = await this.db().stripeEvent.updateMany({
        where: { id: evento.id, alertedAt: null },
        data: { alertedAt: new Date() },
      }).catch(() => ({ count: 0 }));
      if (claimed.count !== 1) continue;
      this.logger.error(`Evento Stripe ${evento.id} esgotou as tentativas e saiu da fila.`);
      await this.mail.sendOperationsAlert(
        "Evento Stripe parou de ser reprocessado",
        [
          `Evento: ${evento.id}`,
          `Tipo: ${evento.type}`,
          `Tentativas: ${evento.attempts}`,
          `Último erro: ${evento.lastError ?? "não registrado"}`,
          "O evento não será reprocessado automaticamente. Verifique em /super-admin/operacao.",
        ],
      ).catch((error: unknown) => {
        this.logger.error("Não foi possível enviar o alerta de evento Stripe.", this.stripeErrorForLog(error));
      });
    }

    // Sem filtro de tentativas: FALHOU é terminal em qualquer caminho — tanto o
    // esgotamento quanto o erro definitivo (conta Connect ausente, por
    // exemplo). Nos dois casos o dinheiro não saiu e alguém precisa olhar.
    const lotes = await this.db().payoutBatch.findMany({
      where: {
        status: PayoutBatchStatus.FALHOU,
        alertedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, resellerId: true, amount: true, currency: true, failureReason: true },
    }).catch(() => []);

    for (const lote of lotes) {
      const claimed = await this.db().payoutBatch.updateMany({
        where: { id: lote.id, alertedAt: null },
        data: { alertedAt: new Date() },
      }).catch(() => ({ count: 0 }));
      if (claimed.count !== 1) continue;
      this.logger.error(`Repasse ${lote.id} esgotou as tentativas.`);
      await this.mail.sendOperationsAlert(
        "Repasse ao revendedor encerrado sem confirmação",
        [
          `Lote: ${lote.id}`,
          `Revendedor: ${lote.resellerId}`,
          `Valor: ${lote.amount} ${String(lote.currency).toUpperCase()}`,
          `Motivo: ${lote.failureReason ?? "não registrado"}`,
          "As comissões voltaram para o saldo disponível; o revendedor pode solicitar novamente.",
        ],
      ).catch((error: unknown) => {
        this.logger.error("Não foi possível enviar o alerta de repasse.", this.stripeErrorForLog(error));
      });
    }
  }

  private async processPendingPayouts() {
    const viaAsaas = this.billingProvider() === "ASAAS";
    if (!viaAsaas && !this.stripe) return;
    const batches = await this.db().payoutBatch.findMany({
      where: {
        status: PayoutBatchStatus.PROCESSANDO,
        createdAt: { lt: new Date(Date.now() - 10_000) },
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: new Date() } },
            ],
          },
          ...(viaAsaas
            ? [{ OR: [{ asaasTransferId: { not: null } }, { attempts: { lt: MAX_PAYOUT_ATTEMPTS } }] }]
            : [{ attempts: { lt: MAX_PAYOUT_ATTEMPTS } }]),
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 10,
      select: { id: true, asaasTransferId: true },
    }).catch((error: unknown) => {
      this.logger.error(
        "Não foi possível consultar repasses pendentes.",
        this.stripeErrorForLog(error),
      );
      return [];
    });
    for (const batch of batches) {
      const process = viaAsaas && batch.asaasTransferId
        ? this.reconcileAsaasPayoutBatch(batch.id)
        : this.executePayoutBatch(batch.id, true);
      await process.catch((error: unknown) => {
        this.logger.error(
          `Falha ao recuperar o repasse ${batch.id}.`,
          this.stripeErrorForLog(error),
        );
      });
    }
  }

  /** Confere uma transferência interna que ainda não retornou como concluída. */
  private async reconcileAsaasPayoutBatch(batchId: string) {
    const batch = await this.db().payoutBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, asaasTransferId: true },
    });
    if (!batch || batch.status !== PayoutBatchStatus.PROCESSANDO || !batch.asaasTransferId) return null;

    let transfer: AsaasTransfer | null;
    try {
      transfer = await this.asaas.findTransferByReference(`payout-${batch.id}`);
    } catch (error) {
      // Falha de consulta não autoriza uma nova transferência nem deve fazer o
      // worker chamar o Asaas a cada rodada de 5 segundos. Mantemos o lote
      // bloqueado e voltamos a conferir em um minuto.
      await this.db().payoutBatch.update({
        where: { id: batch.id },
        data: {
          failureReason: "Não foi possível confirmar a transferência no Asaas; nova conferência agendada.",
          nextAttemptAt: new Date(Date.now() + ASAAS_PAYOUT_RECHECK_INTERVAL_MS),
        },
      });
      this.logger.warn(
        `Não foi possível consultar o repasse Asaas ${batch.id}; a mesma referência será verificada novamente.`,
        this.stripeErrorForLog(error),
      );
      return { transferId: batch.asaasTransferId, processing: true };
    }
    if (!transfer) {
      // Não recriamos por conta própria quando a consulta falha/está atrasada:
      // a referência é nossa barreira contra pagamento em duplicidade.
      await this.db().payoutBatch.update({
        where: { id: batch.id },
        data: {
          failureReason: "Aguardando localização da transferência no Asaas.",
          nextAttemptAt: new Date(Date.now() + ASAAS_PAYOUT_RECHECK_INTERVAL_MS),
        },
      });
      return { transferId: batch.asaasTransferId, processing: true };
    }
    if (this.isAsaasTransferDone(transfer)) {
      await this.completePayoutBatch(batch.id, { asaasTransferId: transfer.id });
      return { transferId: transfer.id, completed: true };
    }
    if (this.isAsaasTransferTerminalFailure(transfer)) {
      await this.failPayoutBatch(batch.id, "O Asaas informou que o repasse foi recusado ou cancelado; o saldo voltou a ficar disponível.");
      return { transferId: transfer.id, failed: true };
    }
    await this.db().payoutBatch.update({
      where: { id: batch.id },
      data: {
        asaasTransferId: transfer.id,
        failureReason: "Transferência em processamento no Asaas.",
        nextAttemptAt: new Date(Date.now() + ASAAS_PAYOUT_RECHECK_INTERVAL_MS),
      },
    });
    return { transferId: transfer.id, processing: true };
  }

  /**
   * Consolida a razão de uso por empresa/métrica antes de criar itens pendentes
   * na próxima fatura Stripe. O idempotency key é calculado dos IDs do ledger,
   * portanto uma queda entre Stripe e banco não duplica cobrança no retry.
   */
  /**
   * Cobrança paga cujo acesso não foi liberado.
   *
   * O webhook é o caminho normal, mas ele tem três formas de falhar fora do
   * nosso alcance: estar desativado no painel, ser desativado pelo Asaas após
   * acumular erro, ou o evento se perder. Em qualquer uma delas o cliente pagou
   * e ficou sem o produto — situação em que ninguém aceita esperar suporte.
   *
   * Por isso conferimos periodicamente as cobranças que ainda constam em aberto:
   * quem estiver paga é ativada aqui. A ativação é idempotente, então rodar em
   * paralelo com o webhook não duplica comissão.
   */
  private async reconcilePendingAsaasPayments() {
    const pendentes = await this.db().clientSubscription.findMany({
      where: {
        asaasPaymentId: { not: null },
        status: { not: SubscriptionStatus.ATIVA },
      },
      select: { id: true, companyId: true, asaasPaymentId: true, asaasSubscriptionId: true },
      take: 50,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar cobranças pendentes do Asaas.", this.stripeErrorForLog(error));
      return [];
    });

    for (const assinatura of pendentes) {
      try {
        const cobranca = await this.asaas.getPayment(assinatura.asaasPaymentId!);
        if (!ASAAS_PAID_STATUSES.includes(cobranca.status)) continue;
        this.logger.warn(
          `Conciliação: cobrança ${cobranca.id} da empresa ${assinatura.companyId} estava paga sem ativação. Verifique o webhook no painel do Asaas.`,
        );
        await this.activateFromAsaasPayment({
          id: cobranca.id,
          value: cobranca.value,
          status: cobranca.status,
          subscription: cobranca.subscription ?? assinatura.asaasSubscriptionId,
          customer: cobranca.customer,
        }, { fundsReceived: this.asaasPaymentHasSettledFunds(cobranca) });
        await this.markAsaasUsagePaid(cobranca.id);
      } catch (error) {
        this.logger.error(
          `Não foi possível conciliar a cobrança da empresa ${assinatura.companyId}.`,
          this.stripeErrorForLog(error),
        );
      }
    }
  }

  /**
   * Se o callback PAYMENT_RECEIVED se perder, uma previsão de comissão não
   * pode ficar eternamente em compensação. Consultamos a cobrança de forma
   * limitada e a liberamos somente quando a API do Asaas confirma o crédito.
   */
  private async reconcilePendingAsaasCommissions() {
    const ledger = this.db().commissionLedger;
    if (!ledger?.findMany || !ledger?.findUnique || !this.asaas.isConfigured?.()) return;
    const candidates = await ledger.findMany({
      where: {
        asaasPaymentId: { not: null },
        status: CommissionStatus.PENDENTE,
        settledAt: null,
      },
      select: { asaasPaymentId: true },
      distinct: ["asaasPaymentId"],
      take: 20,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar comissões Asaas em compensação.", this.stripeErrorForLog(error));
      return [];
    });

    for (const candidate of candidates) {
      const paymentId = String(candidate.asaasPaymentId ?? "");
      if (!paymentId || !this.deveConferir(`comissao:${paymentId}`, ASAAS_USAGE_RECHECK_INTERVAL_MS)) continue;
      try {
        const payment = await this.asaas.findPayment(paymentId);
        if (!payment || !this.asaasPaymentHasSettledFunds(payment)) continue;
        const entry = await ledger.findUnique({
          where: { asaasPaymentId: paymentId },
          include: { subscription: { include: { reseller: true, plan: true } } },
        });
        if (!entry?.subscription) continue;
        await this.recordAsaasCommission(entry.subscription, payment, { fundsReceived: true });
        this.logger.warn(`Conciliação: comissão da cobrança ${paymentId} foi liberada sem webhook PAYMENT_RECEIVED.`);
      } catch (error) {
        this.logger.error(
          `Não foi possível conciliar a comissão da cobrança ${paymentId}.`,
          this.stripeErrorForLog(error),
        );
      }
    }
  }

  /**
   * A primeira ativação guarda `asaasPaymentId`, mas as renovações recorrentes
   * não. Se o webhook de uma renovação falhar, ainda assim precisamos recuperar
   * uma fatura já paga antes de manter a empresa bloqueada pelo fim do ciclo.
   */
  private async reconcileAsaasPaidSubscription(assinatura: {
    companyId: string;
    status: SubscriptionStatus;
    asaasSubscriptionId?: string | null;
    asaasPaymentId?: string | null;
    asaasPeriodPaymentId?: string | null;
    currentPeriodEnd?: Date | string | null;
  }) {
    if (!assinatura.asaasSubscriptionId || !this.asaas.isConfigured?.()) return null;
    try {
      const cobrancas = await this.asaas.listSubscriptionPayments(assinatura.asaasSubscriptionId);
      const paga = cobrancas
        .filter((item) => !item.deleted && ASAAS_PAID_STATUSES.includes(item.status))
        .sort((left, right) => String(right.dueDate ?? "").localeCompare(String(left.dueDate ?? "")))[0];
      if (!paga || !this.asaasPaymentCanRenewPeriod(assinatura, paga)) return null;
      const activation = await this.activateFromAsaasPayment({
        ...paga,
        subscription: paga.subscription ?? assinatura.asaasSubscriptionId,
      }, { fundsReceived: this.asaasPaymentHasSettledFunds(paga) });
      if (!activation) return null;
      await this.markAsaasUsagePaid(paga.id);
      this.logger.warn(
        `Conciliação: pagamento ${paga.id} da empresa ${assinatura.companyId} renovou o ciclo sem webhook.`,
      );
      return activation;
    } catch (error) {
      this.logger.error(
        `Não foi possível conciliar renovação Asaas da empresa ${assinatura.companyId}.`,
        this.stripeErrorForLog(error),
      );
      return null;
    }
  }

  /** Evita que uma fatura antiga paga reabra indevidamente um ciclo vencido. */
  private asaasPaymentCanRenewPeriod(
    assinatura: {
      status?: SubscriptionStatus;
      asaasPaymentId?: string | null;
      asaasPeriodPaymentId?: string | null;
      currentPeriodEnd?: Date | string | null;
    },
    cobranca: AsaasPayment,
  ) {
    if (assinatura.asaasPeriodPaymentId) {
      return assinatura.asaasPeriodPaymentId !== cobranca.id || assinatura.status !== SubscriptionStatus.ATIVA;
    }
    if (assinatura.asaasPaymentId === cobranca.id) return true;
    const fimDoPeriodo = assinatura.currentPeriodEnd ? new Date(assinatura.currentPeriodEnd) : null;
    if (!fimDoPeriodo || Number.isNaN(fimDoPeriodo.getTime())) return false;
    const vencimento = String(cobranca.dueDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return false;
    const fimLocal = this.saoPauloCalendarDate(fimDoPeriodo);
    // A renovação paga tem vencimento do ciclo que acabou de encerrar (ou
    // posterior em caso de pagamento antecipado), nunca anterior a ele.
    return vencimento >= fimLocal;
  }

  /** Recupera renovações pagas sem depender de o cliente abrir a página. */
  private async reconcilePaidAsaasRenewals() {
    const subscriptionsModel = this.db().clientSubscription;
    if (!subscriptionsModel?.findMany) return;
    const subscriptions = await subscriptionsModel.findMany({
      where: {
        asaasSubscriptionId: { not: null },
        OR: [
          { status: SubscriptionStatus.INADIMPLENTE },
          { status: SubscriptionStatus.ATIVA, currentPeriodEnd: { lt: new Date() } },
        ],
      },
      select: {
        companyId: true,
        status: true,
        asaasSubscriptionId: true,
        asaasPaymentId: true,
        asaasPeriodPaymentId: true,
        currentPeriodEnd: true,
      },
      take: 25,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar renovações Asaas para conciliação.", this.stripeErrorForLog(error));
      return [];
    });
    for (const assinatura of subscriptions) await this.reconcileAsaasPaidSubscription(assinatura);
  }

  /**
   * Mensalidade vencida sem ninguém avisar.
   *
   * O bloqueio depende de a assinatura estar `INADIMPLENTE`, e quem faz essa
   * marcação é o evento `PAYMENT_OVERDUE`. Com o webhook desativado ou falhando,
   * o cliente continuaria usando sem pagar — e o consumo de IA e WhatsApp desse
   * período é custo nosso, que não volta.
   *
   * Só olha quem já passou do período pago, então o conjunto é pequeno e se
   * esvazia sozinho: marcada a inadimplência, a assinatura sai do filtro.
   */
  private async reconcileOverdueAsaasPayments() {
    const vencidas = await this.db().clientSubscription.findMany({
      where: {
        status: SubscriptionStatus.ATIVA,
        asaasSubscriptionId: { not: null },
        currentPeriodEnd: { lt: new Date() },
      },
      select: { id: true, companyId: true, asaasSubscriptionId: true, status: true, currentPeriodEnd: true },
      take: 25,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar assinaturas fora do período pago.", this.stripeErrorForLog(error));
      return [];
    });

    for (const assinatura of vencidas) await this.reconcileAsaasSubscriptionOverdue(assinatura);
  }

  /**
   * O período registrado localmente é o limite de acesso. Atualizamos o status
   * de modo condicional para não sobrescrever uma renovação que tenha chegado
   * entre a leitura e esta escrita.
   */
  private async markSubscriptionOverdueIfPeriodExpired(
    assinatura: {
      id: string;
      companyId: string;
      status: SubscriptionStatus;
      currentPeriodEnd?: Date | string | null;
    },
    now = new Date(),
  ) {
    const fimDoPeriodo = assinatura.currentPeriodEnd ? new Date(assinatura.currentPeriodEnd) : null;
    if (
      assinatura.status !== SubscriptionStatus.ATIVA
      || !fimDoPeriodo
      || Number.isNaN(fimDoPeriodo.getTime())
      || fimDoPeriodo.getTime() >= now.getTime()
    ) {
      return false;
    }
    const result = await this.db().clientSubscription.updateMany({
      where: {
        id: assinatura.id,
        status: SubscriptionStatus.ATIVA,
        currentPeriodEnd: { lt: now },
      },
      data: { status: SubscriptionStatus.INADIMPLENTE },
    }).catch((error: unknown) => {
      this.logger.error(
        `Não foi possível registrar o vencimento da empresa ${assinatura.companyId}.`,
        this.stripeErrorForLog(error),
      );
      return { count: 0 };
    });
    if (result.count > 0) {
      this.logger.warn(
        `Conciliação: empresa ${assinatura.companyId} marcada INADIMPLENTE porque o período contratado terminou.`,
      );
      return true;
    }
    return false;
  }

  /** Garante a mesma transição para empresas que não abrirem o painel. */
  private async reconcileExpiredSubscriptionPeriods() {
    const result = await this.db().clientSubscription.updateMany({
      where: {
        status: SubscriptionStatus.ATIVA,
        currentPeriodEnd: { lt: new Date() },
      },
      data: { status: SubscriptionStatus.INADIMPLENTE },
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível encerrar períodos de assinatura vencidos.", this.stripeErrorForLog(error));
      return { count: 0 };
    });
    if (result.count > 0) {
      this.logger.warn(`Conciliação: ${result.count} assinatura(s) marcada(s) INADIMPLENTE por fim de período.`);
    }
  }

  /**
   * Confere uma assinatura Asaas fora do período pago e, se a cobrança também
   * estiver vencida, persiste a inadimplência que o guard usa para bloquear.
   * A mesma operação é usada no worker e na leitura do status do painel.
   */
  private async reconcileAsaasSubscriptionOverdue(
    assinatura: {
      id: string;
      companyId: string;
      asaasSubscriptionId?: string | null;
      status: SubscriptionStatus;
      currentPeriodEnd?: Date | string | null;
    },
    options: { bypassInterval?: boolean } = {},
  ) {
    const fimDoPeriodo = assinatura.currentPeriodEnd ? new Date(assinatura.currentPeriodEnd) : null;
    if (
      assinatura.status !== SubscriptionStatus.ATIVA
      || !assinatura.asaasSubscriptionId
      || !fimDoPeriodo
      || Number.isNaN(fimDoPeriodo.getTime())
      || fimDoPeriodo.getTime() >= Date.now()
      || !this.asaas.isConfigured()
    ) {
      return false;
    }
    if (
      !options.bypassInterval
      && !this.deveConferir(`vencimento:${assinatura.id}`, ASAAS_OVERDUE_RECHECK_INTERVAL_MS)
    ) {
      return false;
    }
    try {
      const cobrancas = await this.asaas.listSubscriptionPayments(assinatura.asaasSubscriptionId);
      if (!cobrancas.some((item) => this.isAsaasPaymentOverdue(item))) return false;
      await this.db().clientSubscription.update({
        where: { id: assinatura.id },
        data: { status: SubscriptionStatus.INADIMPLENTE },
      });
      this.logger.warn(
        `Conciliação: empresa ${assinatura.companyId} marcada INADIMPLENTE por cobrança vencida no Asaas.`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Não foi possível conferir vencimento da empresa ${assinatura.companyId}.`,
        this.stripeErrorForLog(error),
      );
      return false;
    }
  }

  /**
   * Consumo variável no Asaas. Não existe item de fatura como no Stripe: o que
   * há é a cobrança da assinatura, ainda em aberto, cujo valor pode ser
   * atualizado. Somamos o consumo a ela, de modo que o cliente receba um boleto
   * ou Pix só — em vez de uma segunda cobrança avulsa todo mês.
   *
   * Somamos ao valor atual da cobrança, não ao valor do plano: cada lançamento
   * sai da fila ao ser somado, então rodar de novo no mesmo ciclo acrescenta só
   * o que entrou depois.
   */
  private async syncVariableUsageToAsaas() {
    const pending = await this.usage.pendingBillableEntries().catch((error: unknown) => {
      this.logger.error("Não foi possível ler o consumo variável pendente.", this.stripeErrorForLog(error));
      return [];
    });

    const porEmpresa = new Map<string, any[]>();
    for (const entry of pending) {
      porEmpresa.set(entry.companyId, [...(porEmpresa.get(entry.companyId) ?? []), entry]);
    }

    for (const [companyId, entries] of porEmpresa) {
      const subscription = await this.db().clientSubscription.findUnique({
        where: { companyId },
        select: { asaasSubscriptionId: true, asaasCustomerId: true, status: true },
      });
      if (!subscription?.asaasSubscriptionId || subscription.status !== SubscriptionStatus.ATIVA) continue;

      const total = Math.round(entries.reduce((sum, entry) => sum + Number(entry.billableAmount), 0) * 100) / 100;
      if (total <= 0) continue;

      const detalhe = entries
        .map((entry) => `${usageMetricLabel(entry.metric)} ${formatUsageQuantity(Number(entry.quantity))}`)
        .join(", ");

      try {
        const cobrancas = await this.asaas.listSubscriptionPayments(subscription.asaasSubscriptionId);
        // Só cobrança ainda em aberto aceita mudança de valor.
        const emAberto = cobrancas
          .filter((item) => ["PENDING", "AWAITING_RISK_ANALYSIS"].includes(item.status))
          .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];

        // Nunca uma cobrança à parte: a regra é uma cobrança só, com o total.
        // Sem mensalidade em aberto, o consumo continua pendente e entra na
        // próxima — acumular é o comportamento correto, não uma falha.
        if (!emAberto) {
          this.logger.log(
            `Empresa ${companyId} sem mensalidade em aberto; ${total.toFixed(2)} de consumo acumulando para a próxima cobrança.`,
          );
          continue;
        }
        const cobrancaId = await this.addUsageToOpenPayment(emAberto, total, detalhe);

        await this.db().usageLedger.updateMany({
          where: {
            id: { in: entries.map((entry) => entry.id) },
            status: UsageLedgerStatus.PENDENTE,
            trialCoveredAt: null,
          },
          data: { status: UsageLedgerStatus.SINCRONIZADO, asaasPaymentId: cobrancaId },
        });
      } catch (error) {
        this.logger.error(
          `Não foi possível somar o consumo variável da empresa ${companyId} à cobrança do Asaas.`,
          this.stripeErrorForLog(error),
        );
      }
    }
  }

  /**
   * Soma à cobrança informada todo o consumo faturável ainda pendente da empresa.
   *
   * Usado na ativação: o consumo acumulado desde o fim do teste precisa entrar na
   * mesma fatura, e não em uma segunda cobrança. Falhar aqui não invalida a
   * ativação — o consumo continua pendente e entra na cobrança seguinte, então
   * preferimos devolver o link do que abortar por causa do acréscimo.
   */
  private async addPendingUsageToPayment(companyId: string, cobranca: AsaasPayment) {
    try {
      // Inclui o consumo do teste: ele entra na fatura de quem assina e é
      // perdoado para quem desiste, então a ativação é o momento em que deixa de
      // ser cortesia. O `trialCoveredAt` fica no lançamento como registro de que
      // aconteceu durante o teste.
      const pendentes = await this.db().usageLedger.findMany({
        where: {
          companyId,
          status: UsageLedgerStatus.PENDENTE,
          billableAmount: { gt: 0 },
        },
        orderBy: { createdAt: "asc" },
      });
      const total = Math.round(pendentes.reduce((soma: number, item: any) => soma + Number(item.billableAmount), 0) * 100) / 100;
      if (total <= 0) return cobranca;

      const detalhe = pendentes
        .map((item: any) => `${usageMetricLabel(item.metric)} ${formatUsageQuantity(Number(item.quantity))}`)
        .join(", ");
      await this.addUsageToOpenPayment(cobranca, total, detalhe);
      await this.db().usageLedger.updateMany({
        where: {
          id: { in: pendentes.map((item: any) => item.id) },
          status: UsageLedgerStatus.PENDENTE,
        },
        data: { status: UsageLedgerStatus.SINCRONIZADO, asaasPaymentId: cobranca.id },
      });
      this.logger.log(`Ativação da empresa ${companyId} inclui ${total.toFixed(2)} de consumo acumulado.`);
      // O link não muda quando só o valor é alterado, mas relemos para a tela
      // nunca mostrar um valor diferente do que está na fatura.
      return await this.asaas.getPayment(cobranca.id).catch(() => cobranca);
    } catch (error) {
      this.logger.error(
        `Não foi possível somar o consumo acumulado à ativação da empresa ${companyId}.`,
        this.stripeErrorForLog(error),
      );
      return cobranca;
    }
  }

  /** Consumo somado à cobrança da mensalidade: uma fatura só, sempre. */
  private async addUsageToOpenPayment(cobranca: { id: string; value: number }, total: number, detalhe: string) {
    await this.asaas.updatePayment(cobranca.id, {
      value: Math.round((Number(cobranca.value) + total) * 100) / 100,
      description: `ChegowIA — mensalidade + uso variável (${detalhe})`.slice(0, 500),
    });
    return cobranca.id;
  }

  /**
   * Cobrança vencida.
   *
   * O rótulo `OVERDUE` só aparece na virada do dia do Asaas, não no instante em
   * que a data passa. Esperar por ele deixaria o bloqueio na agenda deles — e uma
   * cobrança em aberto com vencimento no passado está vencida, com ou sem
   * rótulo. A data é comparada no fuso de São Paulo, que é onde o vencimento é
   * lido pelo cliente.
   */
  private isAsaasPaymentOverdue(cobranca: { status: string; dueDate?: string | null }) {
    if (cobranca.status === "OVERDUE") return true;
    if (!["PENDING", "AWAITING_RISK_ANALYSIS"].includes(cobranca.status)) return false;
    const vencimento = String(cobranca.dueDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return false;
    const hoje = this.saoPauloCalendarDate();
    return vencimento < hoje;
  }

  /**
   * Quando o nosso período já encerrou no meio do dia, a cobrança do próprio
   * dia precisa poder ser paga imediatamente. Ela ainda não é "vencida" para o
   * Asaas, mas é a única cobrança que regulariza o acesso agora.
   */
  private isAsaasPaymentPayableNow(cobranca: { status: string; dueDate?: string | null }) {
    if (this.isAsaasPaymentOverdue(cobranca)) return true;
    if (!["PENDING", "AWAITING_RISK_ANALYSIS"].includes(cobranca.status)) return false;
    return String(cobranca.dueDate ?? "") === this.saoPauloCalendarDate();
  }

  /**
   * `toLocaleDateString("en-CA")` não é estável entre builds do Node: alguns
   * runtimes devolvem MM/DD/AAAA. Montamos a data pelas partes para comparar o
   * vencimento Asaas (AAAA-MM-DD) sem depender da localidade do container.
   */
  private saoPauloCalendarDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  /**
   * Consumo sincronizado cuja confirmação não chegou pelo webhook.
   *
   * No worker só olhamos lançamentos com pelo menos dez minutos para não
   * disputar a rotina que acabou de somá-los à fatura. No painel, a empresa
   * consultada pula essa espera: pagou, a baixa precisa aparecer na próxima
   * resposta HTTP, não uma hora depois.
   */
  private async reconcileAsaasUsagePayments(
    companyId?: string,
    options: { bypassInterval?: boolean } = {},
  ) {
    const ledger = this.db().usageLedger;
    if (!ledger?.findMany || !this.asaas.isConfigured?.()) return;
    const limite = new Date(Date.now() - 10 * 60_000);
    const candidatos = await ledger.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: UsageLedgerStatus.SINCRONIZADO,
        asaasPaymentId: { not: null },
        ...(options.bypassInterval ? {} : { updatedAt: { lt: limite } }),
      },
      select: { asaasPaymentId: true },
      distinct: ["asaasPaymentId"],
      take: 20,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar consumo já faturado.", this.stripeErrorForLog(error));
      return [];
    });

    for (const item of candidatos) {
      const paymentId = String(item.asaasPaymentId ?? "");
      if (!paymentId) continue;
      // A tela força a leitura atual; o worker continua limitado para não
      // consultar a mesma cobrança a cada 5s enquanto ela está em aberto.
      if (
        !options.bypassInterval
        && !this.deveConferir(`orfao:${paymentId}`, ASAAS_USAGE_RECHECK_INTERVAL_MS)
      ) continue;
      try {
        const cobranca = await this.asaas.findPayment(paymentId);
        if (cobranca && ASAAS_PAID_STATUSES.includes(cobranca.status)) {
          this.logger.warn(`Conciliação: cobrança ${paymentId} estava paga sem baixa do consumo; marcando como FATURADO.`);
          await this.markAsaasUsagePaid(paymentId);
          continue;
        }
        // Ausente ou apagada. Erro de rede não chega aqui: `findPayment` só
        // devolve null em 404, e qualquer outra falha cai no catch.
        if (cobranca && !cobranca.deleted) continue;
        this.logger.warn(`Cobrança ${paymentId} não existe mais no Asaas; devolvendo o consumo à fila.`);
        await this.returnUsageToQueue(paymentId);
      } catch (error) {
        this.logger.error(`Não foi possível conferir a cobrança ${paymentId}.`, this.stripeErrorForLog(error));
      }
    }
  }

  /** Compatibilidade com a rotina de fundo e com a nomenclatura operacional. */
  private async reconcileOrphanUsage() {
    await this.reconcileAsaasUsagePayments();
  }

  /** Cobrança desfeita: o consumo volta para a fila e entra na cobrança seguinte. */
  private async returnUsageToQueue(paymentId: string, options: { includePaid?: boolean } = {}) {
    const status = options.includePaid
      ? { in: [UsageLedgerStatus.SINCRONIZADO, UsageLedgerStatus.FATURADO] }
      : UsageLedgerStatus.SINCRONIZADO;
    const devolvidos = await this.db().usageLedger.updateMany({
      where: { asaasPaymentId: paymentId, status },
      data: { status: UsageLedgerStatus.PENDENTE, asaasPaymentId: null },
    }).catch((error: unknown) => {
      this.logger.error(`Não foi possível devolver à fila o consumo da cobrança ${paymentId}.`, this.stripeErrorForLog(error));
      return { count: 0 };
    });
    if (devolvidos.count) {
      this.logger.log(`Cobrança ${paymentId} apagada: ${devolvidos.count} lançamento(s) de consumo voltaram para a fila.`);
    }
  }

  /** Dinheiro em espécie desfeito reabre a mesma fatura, sem criar duplicata. */
  private async reopenUsageOnSameAsaasPayment(paymentId: string) {
    await this.db().usageLedger.updateMany({
      where: { asaasPaymentId: paymentId, status: UsageLedgerStatus.FATURADO },
      data: { status: UsageLedgerStatus.SINCRONIZADO },
    }).catch((error: unknown) => {
      this.logger.error(`Não foi possível reabrir o consumo da cobrança ${paymentId}.`, this.stripeErrorForLog(error));
    });
  }

  /** Cobrança paga: o consumo que entrou nela deixa de estar pendente. */
  private async markAsaasUsagePaid(paymentId: string) {
    await this.db().usageLedger.updateMany({
      where: { asaasPaymentId: paymentId, status: UsageLedgerStatus.SINCRONIZADO },
      data: { status: UsageLedgerStatus.FATURADO },
    }).catch((error: unknown) => {
      this.logger.error(`Não foi possível conciliar o consumo da cobrança ${paymentId}.`, this.stripeErrorForLog(error));
    });
  }

  private async syncVariableUsageToStripe() {
    if (!this.stripe) return;
    const pending = await this.usage.pendingBillableEntries().catch((error: unknown) => {
      this.logger.error("Não foi possível ler o consumo variável pendente.", this.stripeErrorForLog(error));
      return [];
    });
    const groups = new Map<string, any[]>();
    for (const entry of pending) {
      const key = `${entry.companyId}:${entry.metric}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }

    for (const entries of groups.values()) {
      const [first] = entries;
      const subscription = await this.db().clientSubscription.findUnique({
        where: { companyId: first.companyId },
        select: {
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          status: true,
        },
      });
      if (
        !subscription?.stripeCustomerId
        || subscription.status !== SubscriptionStatus.ATIVA
      ) {
        continue;
      }
      const amountCents = Math.round(entries.reduce((sum, entry) => sum + Number(entry.billableAmount), 0) * 100);
      if (amountCents <= 0) continue;

      const ids = entries.map((entry) => entry.id).sort();
      const quantity = entries.reduce((sum, entry) => sum + Number(entry.quantity), 0);
      const keyHash = createHash("sha256").update(ids.join(":"), "utf8").digest("hex");
      try {
        const item = await this.stripe.invoiceItems.create({
          customer: subscription.stripeCustomerId,
          subscription: subscription.stripeSubscriptionId ?? undefined,
          currency: "brl",
          amount: amountCents,
          discountable: false,
          description: `Uso variável ChegowIA — ${usageMetricLabel(first.metric)} (${formatUsageQuantity(quantity)})`,
          metadata: {
            chegowia_usage_metric: first.metric,
            chegowia_usage_entries: String(ids.length),
            chegowia_usage_hash: keyHash.slice(0, 40),
          },
        }, { idempotencyKey: `usage-${keyHash}` });
        const invoice = item.invoice;
        const stripeInvoiceId = typeof invoice === "string" ? invoice : invoice?.id ?? null;
        await this.db().usageLedger.updateMany({
          where: { id: { in: ids }, status: UsageLedgerStatus.PENDENTE, trialCoveredAt: null },
          data: {
            status: UsageLedgerStatus.SINCRONIZADO,
            stripeInvoiceItemId: item.id,
            stripeInvoiceId,
          },
        });
      } catch (error) {
        this.logger.error(
          `Não foi possível sincronizar o consumo ${first.metric} da empresa ${first.companyId} com a Stripe.`,
          this.stripeErrorForLog(error),
        );
      }
    }
  }

  private async markVariableUsagePaid(invoice: Stripe.Invoice) {
    if (!this.stripe) return;
    try {
      const lines = invoice.lines?.data?.length
        ? invoice.lines.data
        : (await this.stripe.invoices.listLineItems(invoice.id, { limit: 100 })).data;
      const invoiceItemIds = lines
        .map((line: any) => line.parent?.invoice_item_details?.invoice_item)
        .filter((id: unknown): id is string => typeof id === "string");
      if (!invoiceItemIds.length) return;
      await this.db().usageLedger.updateMany({
        where: {
          stripeInvoiceItemId: { in: invoiceItemIds },
          status: UsageLedgerStatus.SINCRONIZADO,
        },
        data: { status: UsageLedgerStatus.FATURADO, stripeInvoiceId: invoice.id },
      });
    } catch (error) {
      this.logger.error(`Não foi possível conciliar uso variável da fatura ${invoice.id}.`, this.stripeErrorForLog(error));
    }
  }

  private async processStripeEvent(eventId: string) {
    const claimed = await this.db().stripeEvent.updateMany({
      where: {
        id: eventId,
        status: { in: [StripeEventStatus.PENDENTE, StripeEventStatus.FALHOU] },
        attempts: { lt: MAX_STRIPE_EVENT_ATTEMPTS },
      },
      data: {
        status: StripeEventStatus.PROCESSANDO,
        attempts: { increment: 1 },
        lastError: null,
      },
    }).catch(() => ({ count: 0 }));
    if (claimed.count !== 1) return;

    const stored = await this.db().stripeEvent.findUnique({ where: { id: eventId } });
    if (!stored) return;
    try {
      // A fila atende os dois provedores: o retry, o alerta de esgotamento e a
      // tela de saúde operacional são os mesmos, só o tratamento muda.
      if (stored.provider === BillingProvider.ASAAS) {
        await this.applyAsaasEvent(stored.payload as any);
      } else {
        await this.applyStripeEvent(stored.payload as unknown as Stripe.Event);
      }
      await this.db().stripeEvent.update({
        where: { id: eventId },
        data: {
          status: StripeEventStatus.PROCESSADO,
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const safeError = this.stripeErrorForUser(error, "Falha temporária ao processar o evento.");
      await this.db().stripeEvent.update({
        where: { id: eventId },
        data: {
          status: StripeEventStatus.FALHOU,
          lastError: safeError,
        },
      });
      this.logger.error(`Falha ao processar o evento Stripe ${eventId}`, this.stripeErrorForLog(error));
    }
  }

  /**
   * Webhook do Asaas. Diferente do Stripe, não há assinatura criptográfica do
   * corpo: a autenticação é o token que configuramos ao criar o webhook e que o
   * Asaas devolve no header `asaas-access-token`. Sem ele, qualquer um poderia
   * marcar assinatura como paga.
   */
  async handleAsaasWebhook(token: string | undefined, payload: any) {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    if (!expected) throw new BadRequestException("Webhook do Asaas não configurado.");
    if (!token || !this.safeEqual(token, expected)) {
      throw new UnauthorizedException("Origem do webhook não reconhecida.");
    }

    const eventId = typeof payload?.id === "string" ? payload.id : null;
    const type = typeof payload?.event === "string" ? payload.event : null;
    if (!eventId || !type) return { received: true, ignored: true };

    // Mesmo tratamento de duplicata do Stripe: o Asaas reenvia enquanto não
    // receber 200, e processar duas vezes ativaria a mesma assinatura de novo.
    await this.db().stripeEvent.upsert({
      where: { id: eventId },
      create: {
        id: eventId,
        provider: BillingProvider.ASAAS,
        type,
        payload: JSON.parse(JSON.stringify(payload)),
        status: StripeEventStatus.PENDENTE,
      },
      update: {},
    });
    queueMicrotask(() => void this.processStripeEvent(eventId));
    return { received: true, duplicateSafe: true };
  }

  /**
   * Eventos de cobrança do Asaas. `PAYMENT_CONFIRMED` chega quando o pagamento é
   * reconhecido e `PAYMENT_RECEIVED` quando o dinheiro entra; em espécie o
   * equivalente é `PAYMENT_RECEIVED_IN_CASH`. Para liberar o acesso o primeiro
   * basta, e tratar os três deixa o cliente esperando menos sem antecipar saque.
   */
  private async applyAsaasEvent(payload: any) {
    const evento = String(payload?.event ?? "");
    if (evento.startsWith("TRANSFER_")) {
      await this.applyAsaasTransferEvent(payload);
      return;
    }
    const cobranca = payload?.payment;
    if (!cobranca?.id) return;

    if (
      evento === "PAYMENT_CONFIRMED"
      || evento === "PAYMENT_RECEIVED"
      || evento === "PAYMENT_RECEIVED_IN_CASH"
    ) {
      // Não emitimos mais cobrança avulsa de consumo, mas as que já saíram antes
      // dessa regra continuam existindo. Tratá-las como mensalidade paga
      // renovaria o vínculo do revendedor e pagaria comissão sobre elas.
      if (String(cobranca.externalReference ?? "").startsWith("usage-")) {
        await this.markAsaasUsagePaid(String(cobranca.id));
        return;
      }
      await this.activateFromAsaasPayment(cobranca, {
        // A confirmação libera o acesso para não fazer o empresário esperar,
        // mas o saque do revendedor só ocorre quando o Asaas credita o valor.
        fundsReceived: evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_RECEIVED_IN_CASH",
      });
      await this.markAsaasUsagePaid(String(cobranca.id));
      return;
    }
    if (evento === "PAYMENT_OVERDUE") {
      await this.markAsaasSubscriptionStatus(cobranca, SubscriptionStatus.INADIMPLENTE);
      return;
    }
    // Cobrança apagada no painel: o consumo que estava nela não foi faturado.
    // Sem devolvê-lo à fila, ele ficaria apontando para uma cobrança inexistente
    // e nunca mais seria cobrado — perda silenciosa.
    if (evento === "PAYMENT_DELETED") {
      await this.returnUsageToQueue(String(cobranca.id));
      return;
    }
    // Contestação ainda não é estorno definitivo. Ela retira o saldo de saque
    // até a decisão do Asaas, sem gerar ajuste negativo antes da hora.
    if (evento === "PAYMENT_CHARGEBACK_REQUESTED") {
      await this.suspendAsaasCommission(cobranca);
      await this.markAsaasSubscriptionStatus(cobranca, SubscriptionStatus.INADIMPLENTE, {
        onlyIfCurrentPeriodPayment: true,
      });
      return;
    }
    // Os dois caminhos finais pelos quais um dinheiro recebido volta atrás.
    // Não existe `PAYMENT_REVERSED` no Asaas — o desfazimento de recebimento em
    // dinheiro é que ocupa esse lugar.
    if (
      evento === "PAYMENT_REFUNDED"
      || evento === "PAYMENT_RECEIVED_IN_CASH_UNDONE"
    ) {
      // Estorno final cancela o recebimento: os itens já baixados voltam à fila
      // para não desaparecerem. No desfazimento de dinheiro em espécie, a
      // própria fatura é reaberta; manter o vínculo evita nova cobrança.
      if (evento === "PAYMENT_RECEIVED_IN_CASH_UNDONE") {
        await this.reopenUsageOnSameAsaasPayment(String(cobranca.id));
      } else {
        await this.returnUsageToQueue(String(cobranca.id), { includePaid: true });
      }
      await this.reverseAsaasCommission(cobranca);
      await this.markAsaasSubscriptionStatus(cobranca, SubscriptionStatus.INADIMPLENTE, {
        onlyIfCurrentPeriodPayment: true,
        clearCurrentPeriodPayment: true,
      });
      return;
    }
    if (evento === "SUBSCRIPTION_DELETED" || evento === "SUBSCRIPTION_INACTIVATED") {
      const assinatura = await this.subscriptionFromAsaas(cobranca);
      if (assinatura) {
        await this.db().clientSubscription.update({
          where: { id: assinatura.id },
          data: { status: SubscriptionStatus.CANCELADA, canceledAt: new Date() },
        });
      }
    }
  }

  /**
   * O mesmo webhook do Asaas também pode receber os eventos da transferência.
   * Eles aceleram a baixa do saque; a reconciliação por referência continua como
   * contingência caso essa notificação não esteja habilitada na conta.
   */
  private async applyAsaasTransferEvent(payload: any) {
    const evento = String(payload?.event ?? "");
    const transfer = payload?.transfer;
    if (!transfer?.id) return;
    const batch = await this.db().payoutBatch.findUnique({
      where: { asaasTransferId: String(transfer.id) },
      select: { id: true, status: true },
    }).catch(() => null);
    if (!batch || batch.status !== PayoutBatchStatus.PROCESSANDO) return;

    if (evento === "TRANSFER_DONE" || this.isAsaasTransferDone(transfer)) {
      await this.completePayoutBatch(batch.id, { asaasTransferId: String(transfer.id) });
      return;
    }
    if (
      evento === "TRANSFER_FAILED"
      || evento === "TRANSFER_CANCELLED"
      || evento === "TRANSFER_BLOCKED"
      || this.isAsaasTransferTerminalFailure(transfer)
    ) {
      await this.failPayoutBatch(batch.id, "O Asaas informou que o repasse foi recusado ou cancelado; o saldo voltou a ficar disponível.");
      return;
    }
    await this.db().payoutBatch.update({
      where: { id: batch.id },
      data: {
        failureReason: "Transferência em processamento no Asaas.",
        nextAttemptAt: new Date(Date.now() + ASAAS_PAYOUT_RECHECK_INTERVAL_MS),
      },
    });
  }

  /** Localiza a assinatura da plataforma a partir da cobrança do Asaas. */
  private async subscriptionFromAsaas(cobranca: any) {
    if (cobranca.subscription) {
      const porAssinatura = await this.db().clientSubscription.findUnique({
        where: { asaasSubscriptionId: String(cobranca.subscription) },
        include: { reseller: true, plan: true },
      });
      if (porAssinatura) return porAssinatura;
    }
    // Cobrança avulsa (ativação criada antes da assinatura, por exemplo).
    if (cobranca.customer) {
      return this.db().clientSubscription.findUnique({
        where: { asaasCustomerId: String(cobranca.customer) },
        include: { reseller: true, plan: true },
      });
    }
    return null;
  }

  private async activateFromAsaasPayment(
    cobranca: any,
    options: { fundsReceived?: boolean } = {},
  ) {
    const assinatura = await this.subscriptionFromAsaas(cobranca);
    if (!assinatura) {
      this.logger.warn(`Cobrança ${cobranca.id} paga no Asaas sem assinatura correspondente.`);
      return null;
    }
    if (!this.isAsaasSubscriptionMonthlyPayment(assinatura, cobranca)) {
      this.logger.warn(
        `Cobrança ${cobranca.id} da assinatura ${assinatura.id} não é a mensalidade vinculada; acesso e comissão preservados.`,
      );
      return null;
    }

    const paymentId = String(cobranca.id);
    // Asaas envia PAYMENT_CONFIRMED e depois PAYMENT_RECEIVED para a mesma
    // cobrança. Sem identificar o pagamento que concedeu o ciclo, o segundo
    // evento deslocaria o vencimento e misturaria ciclos de faturamento.
    if (assinatura.asaasPeriodPaymentId === paymentId) {
      // Uma confirmação repetida de uma cobrança que já concedeu este ciclo é
      // idempotente. Se algum evento antigo marcou inadimplência depois dela,
      // a situação paga vence e o acesso é restaurado sem estender a vigência.
      if (assinatura.status !== SubscriptionStatus.ATIVA) {
        await this.db().clientSubscription.update({
          where: { id: assinatura.id },
          data: { status: SubscriptionStatus.ATIVA, canceledAt: null },
        });
      }
      await this.recordAsaasCommission(assinatura, cobranca, options);
      return {
        paymentId,
        currentPeriodStart: assinatura.currentPeriodStart ?? null,
        currentPeriodEnd: assinatura.currentPeriodEnd ?? null,
      };
    }

    const inicioDoPeriodo = new Date();
    // O direito nasce na confirmação de pagamento e dura um mês-calendário.
    // Guardar os dois limites separa consumo já quitado do consumo novo.
    const fimDoPeriodo = new Date(inicioDoPeriodo);
    fimDoPeriodo.setMonth(fimDoPeriodo.getMonth() + 1);
    await this.db().clientSubscription.update({
      where: { id: assinatura.id },
      data: {
        status: SubscriptionStatus.ATIVA,
        currentPeriodStart: inicioDoPeriodo,
        currentPeriodEnd: fimDoPeriodo,
        asaasPeriodPaymentId: paymentId,
        asaasSubscriptionId: cobranca.subscription
          ? String(cobranca.subscription)
          : assinatura.asaasSubscriptionId,
        // A cobrança foi paga: deixa de estar em aberto.
        asaasPaymentId: null,
        canceledAt: null,
        // O desconto por indicação começa com a assinatura paga, não no teste.
        discountEndsAt: assinatura.resellerId && !assinatura.discountEndsAt
          ? new Date(inicioDoPeriodo.getFullYear(), inicioDoPeriodo.getMonth() + 3, inicioDoPeriodo.getDate())
          : assinatura.discountEndsAt,
      },
    });
    await this.recordAsaasCommission(assinatura, cobranca, options);
    return { paymentId, currentPeriodStart: inicioDoPeriodo, currentPeriodEnd: fimDoPeriodo };
  }

  private async markAsaasSubscriptionStatus(
    cobranca: any,
    status: SubscriptionStatus,
    options: { onlyIfCurrentPeriodPayment?: boolean; clearCurrentPeriodPayment?: boolean } = {},
  ) {
    const assinatura = await this.subscriptionFromAsaas(cobranca);
    if (!assinatura) return;
    const paymentId = String(cobranca.id ?? "");
    // Um estorno atrasado de uma fatura antiga não pode derrubar o período mais
    // novo que já foi pago. Registros legados (sem o ID) preservam o bloqueio
    // conservador até a próxima renovação preencher o campo.
    if (
      options.onlyIfCurrentPeriodPayment
      && assinatura.asaasPeriodPaymentId
      && assinatura.asaasPeriodPaymentId !== paymentId
    ) {
      this.logger.warn(
        `Estorno da cobrança ${paymentId} é de um ciclo anterior da assinatura ${assinatura.id}; acesso atual preservado.`,
      );
      return;
    }
    await this.db().clientSubscription.update({
      where: { id: assinatura.id },
      data: {
        status,
        ...(options.clearCurrentPeriodPayment && assinatura.asaasPeriodPaymentId === paymentId
          ? { asaasPeriodPaymentId: null }
          : {}),
      },
    });
  }

  /**
   * Cria a previsão na confirmação e só a libera quando o Asaas informa que o
   * valor foi recebido. Assim o teste não gera comissão, o pagamento confirmado
   * ainda não vira saque e cada recorrência recebe seu próprio lançamento.
   */
  private async recordAsaasCommission(
    assinatura: any,
    cobranca: any,
    options: { fundsReceived?: boolean } = {},
  ) {
    if (!assinatura.resellerId || !assinatura.reseller?.isActive) return;
    if (!this.hasCompletedCommissionTrial(assinatura)) {
      this.logger.warn(
        `Comissão da cobrança ${cobranca.id} ignorada: o teste da assinatura ${assinatura.id} ainda não terminou.`,
      );
      return;
    }
    if (!this.isAsaasSubscriptionMonthlyPayment(assinatura, cobranca)) return;

    const paymentId = String(cobranca.id ?? "");
    const bruto = this.commissionableMonthlyAmount(assinatura, cobranca.value);
    if (!paymentId || !bruto) return;

    const taxa = this.resellerCommissionRate(assinatura.reseller);
    const valorComissao = Math.round(bruto * taxa * 100) / 100;
    const fundsReceived = Boolean(options.fundsReceived || this.asaasPaymentHasSettledFunds(cobranca));
    const now = new Date();
    const holdDays = this.asaasPostReceiptHoldDays();
    const disponivelEm = fundsReceived
      ? new Date(now.getTime() + holdDays * 24 * 60 * 60 * 1000)
      : null;
    const status = fundsReceived && holdDays === 0
      ? CommissionStatus.DISPONIVEL
      : CommissionStatus.PENDENTE;
    const ledger = this.db().commissionLedger;

    await ledger.upsert({
      // O id da cobrança é único: CONFIRMED/RECEIVED e retries não duplicam.
      where: { asaasPaymentId: paymentId },
      create: {
        resellerId: assinatura.resellerId,
        subscriptionId: assinatura.id,
        asaasPaymentId: paymentId,
        // O total da cobrança pode incluir IA/WhatsApp; a base aqui é somente
        // a mensalidade contratada, para proteger a margem operacional.
        grossAmount: bruto,
        commissionRate: taxa,
        commissionAmount: valorComissao,
        currency: "brl",
        status,
        settledAt: fundsReceived ? now : null,
        availableAt: disponivelEm,
        holdReason: fundsReceived ? null : COMMISSION_HOLD_AWAITING_SETTLEMENT,
      },
      update: {},
    });

    if (!fundsReceived) return;

    // Se CONFIRMED chegou antes, transforma somente a previsão pendente. Nunca
    // reabre lançamento estornado, pago ou já enviado para a subconta.
    await ledger.updateMany({
      where: {
        asaasPaymentId: paymentId,
        status: CommissionStatus.PENDENTE,
      },
      data: {
        status,
        settledAt: now,
        availableAt: disponivelEm,
        holdReason: null,
      },
    });
    if (status === CommissionStatus.DISPONIVEL) {
      await this.notifyAvailableAsaasCommissions(assinatura.resellerId);
    }
  }

  /** A contestação impede novo saque, mas não é um estorno definitivo. */
  private async suspendAsaasCommission(cobranca: any) {
    await this.db().commissionLedger.updateMany({
      where: {
        asaasPaymentId: String(cobranca.id),
        status: { in: [CommissionStatus.PENDENTE, CommissionStatus.DISPONIVEL] },
      },
      data: {
        status: CommissionStatus.PENDENTE,
        settledAt: null,
        availableAt: null,
        holdReason: COMMISSION_HOLD_CHARGEBACK,
      },
    });
  }

  /**
   * Estorno final remove comissão ainda não sacada. Se ela já saiu ou estava
   * sendo enviada, gera um ajuste negativo idempotente que será compensado em
   * comissões futuras — nunca cobra o mesmo cliente nem paga duas vezes.
   */
  private async reverseAsaasCommission(cobranca: any) {
    const paymentId = String(cobranca.id ?? "");
    if (!paymentId) return;
    const ledger = this.db().commissionLedger;
    const reversed = await ledger.updateMany({
      where: {
        asaasPaymentId: paymentId,
        status: { in: [CommissionStatus.PENDENTE, CommissionStatus.DISPONIVEL] },
      },
      data: {
        status: CommissionStatus.ESTORNADA,
        holdReason: "PAGAMENTO_ESTORNADO",
      },
    });
    if (reversed.count > 0 || !ledger.findUnique) return;

    const original = await ledger.findUnique({ where: { asaasPaymentId: paymentId } });
    if (!original) {
      // O evento final pode chegar antes do de recebimento. Deixar uma marca
      // estornada evita que um callback atrasado crie saldo depois do estorno.
      const assinatura = await this.subscriptionFromAsaas(cobranca);
      if (!assinatura?.resellerId || !assinatura.reseller?.isActive) return;
      // Mesmo se algum evento final chegar fora de ordem, a marca de estorno é
      // conservada. Assim um PAYMENT_RECEIVED atrasado jamais cria saldo para
      // uma cobrança que já foi desfeita — inclusive em dados históricos.
      if (!this.isAsaasSubscriptionMonthlyPayment(assinatura, cobranca)) return;
      const bruto = this.commissionableMonthlyAmount(assinatura, cobranca.value);
      if (!bruto) return;
      const taxa = this.resellerCommissionRate(assinatura.reseller);
      await ledger.upsert({
        where: { asaasPaymentId: paymentId },
        create: {
          resellerId: assinatura.resellerId,
          subscriptionId: assinatura.id,
          asaasPaymentId: paymentId,
          grossAmount: bruto,
          commissionRate: taxa,
          commissionAmount: Math.round(bruto * taxa * 100) / 100,
          currency: "brl",
          status: CommissionStatus.ESTORNADA,
          holdReason: "PAGAMENTO_ESTORNADO",
        },
        update: {},
      });
      return;
    }

    if (original.status !== CommissionStatus.PAGA && original.status !== CommissionStatus.PROCESSANDO) return;
    const reference = `asaas-reversal:${paymentId}`;
    await ledger.upsert({
      where: { externalReference: reference },
      create: {
        resellerId: original.resellerId,
        subscriptionId: original.subscriptionId,
        externalReference: reference,
        grossAmount: -Number(original.grossAmount),
        commissionRate: Number(original.commissionRate),
        commissionAmount: -Math.abs(Number(original.commissionAmount)),
        currency: original.currency,
        status: CommissionStatus.DISPONIVEL,
        settledAt: new Date(),
        availableAt: new Date(),
        holdReason: "AJUSTE_DE_ESTORNO",
      },
      update: {},
    });
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async applyStripeEvent(event: Stripe.Event) {
    if (event.type === "checkout.session.completed") {
      await this.completeCheckout(event.data.object as Stripe.Checkout.Session);
      return;
    }
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      await this.recordCommission(invoice);
      await this.markVariableUsagePaid(invoice);
      return;
    }
    if (event.type === "invoice.payment_failed") {
      await this.updateSubscriptionFromInvoice(
        event.data.object as Stripe.Invoice,
        SubscriptionStatus.INADIMPLENTE,
      );
      return;
    }
    if (event.type === "charge.refunded") {
      await this.recordRefund(event.data.object as Stripe.Charge);
      return;
    }
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      await this.syncSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await this.db().clientSubscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: {
          status: SubscriptionStatus.CANCELADA,
          canceledAt: new Date(),
          currentPeriodEnd: this.subscriptionPeriodEnd(subscription),
        },
      });
      return;
    }
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await this.db().resellerProfile.updateMany({
        where: { stripeAccountId: account.id },
        data: { stripeOnboardingOk: this.isStripeAccountReady(account) },
      });
    }
  }

  private async syncSubscription(subscription: Stripe.Subscription) {
    const activeStatuses = new Set(["active", "trialing"]);
    const lateStatuses = new Set(["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"]);
    const status = activeStatuses.has(subscription.status)
      ? SubscriptionStatus.ATIVA
      : lateStatuses.has(subscription.status)
        ? SubscriptionStatus.INADIMPLENTE
        : SubscriptionStatus.CANCELADA;
    await this.db().clientSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status,
        currentPeriodStart: this.subscriptionPeriodStart(subscription),
        currentPeriodEnd: this.subscriptionPeriodEnd(subscription),
        canceledAt: status === SubscriptionStatus.CANCELADA ? new Date() : null,
      },
    });
  }

  private subscriptionPeriodEnd(subscription: Stripe.Subscription) {
    const timestamp = subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => b - a)[0];
    return timestamp ? new Date(timestamp * 1000) : null;
  }

  private subscriptionPeriodStart(subscription: Stripe.Subscription) {
    const timestamp = subscription.items.data
      .map((item) => item.current_period_start)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b)[0];
    return timestamp ? new Date(timestamp * 1000) : null;
  }

  private isTrialActive(subscription: { status: SubscriptionStatus; trialEndsAt?: Date | null }, at = new Date()) {
    return subscription.status === SubscriptionStatus.EM_TESTE
      && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() > at.getTime());
  }

  private isTrialExpired(subscription: { status: SubscriptionStatus; trialEndsAt?: Date | null }, at = new Date()) {
    return subscription.status === SubscriptionStatus.EM_TESTE
      && Boolean(subscription.trialEndsAt && subscription.trialEndsAt.getTime() <= at.getTime());
  }

  private subscriptionIdFromInvoice(invoice: Stripe.Invoice) {
    const modern = invoice.parent?.subscription_details?.subscription;
    if (typeof modern === "string") return modern;
    if (modern && typeof modern === "object") return modern.id;
    const legacy = (invoice as Stripe.Invoice & {
      subscription?: string | Stripe.Subscription | null;
    }).subscription;
    return typeof legacy === "string" ? legacy : legacy?.id;
  }

  private async releaseMatureCommissions(resellerId?: string) {
    const ledger = this.db().commissionLedger;
    if (!ledger?.updateMany) return;
    const released = await ledger.updateMany({
      where: {
        ...(resellerId ? { resellerId } : {}),
        status: CommissionStatus.PENDENTE,
        availableAt: { lte: new Date() },
      },
      data: { status: CommissionStatus.DISPONIVEL },
    });
    if (released.count > 0) await this.notifyAvailableAsaasCommissions(resellerId);
  }

  /**
   * A página explica a regra, e este e-mail avisa no momento em que o valor
   * passa a ficar sacável. A reivindicação condicional evita e-mails repetidos
   * quando API e worker observam a mesma comissão em paralelo.
   */
  private async notifyAvailableAsaasCommissions(resellerId?: string) {
    const ledger = this.db().commissionLedger;
    if (!ledger?.findMany || !ledger?.updateMany || !this.mail?.sendResellerCommissionAvailable) return;
    const entries = await ledger.findMany({
      where: {
        ...(resellerId ? { resellerId } : {}),
        asaasPaymentId: { not: null },
        settledAt: { not: null },
        availabilityNotifiedAt: null,
        status: CommissionStatus.DISPONIVEL,
        commissionAmount: { gt: 0 },
      },
      include: {
        reseller: { include: { user: { select: { name: true, email: true } } } },
        subscription: { include: { company: { select: { name: true } } } },
      },
      take: 30,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível consultar comissões prontas para aviso.", this.stripeErrorForLog(error));
      return [];
    });

    for (const entry of entries) {
      const claimedAt = new Date();
      const claimed = await ledger.updateMany({
        where: { id: entry.id, availabilityNotifiedAt: null },
        data: { availabilityNotifiedAt: claimedAt },
      }).catch(() => ({ count: 0 }));
      if (claimed.count !== 1) continue;
      try {
        await this.mail.sendResellerCommissionAvailable({
          email: entry.reseller.user.email,
          name: entry.reseller.user.name,
          amount: Number(entry.commissionAmount),
          companyName: entry.subscription.company.name,
        });
      } catch (error) {
        // O dinheiro continua correto; recolocamos apenas a notificação para
        // tentar de novo numa próxima rodada, sem bloquear o saque.
        await ledger.updateMany({
          where: { id: entry.id, availabilityNotifiedAt: claimedAt },
          data: { availabilityNotifiedAt: null },
        }).catch(() => undefined);
        this.logger.error(`Não foi possível avisar a comissão ${entry.id}.`, this.stripeErrorForLog(error));
      }
    }
  }

  private async assertStripePrice(
    priceId: string,
    expected: { monthlyPrice: number; currency: string },
  ) {
    if (!this.stripe) throw new BadRequestException("Stripe não configurado.");
    let price: Stripe.Price;
    try {
      price = await this.stripe.prices.retrieve(priceId);
    } catch (error) {
      throw new BadRequestException(this.stripeErrorForUser(error, "Preço Stripe inválido ou inacessível."));
    }
    if (!price.active || price.type !== "recurring" || price.recurring?.interval !== "month") {
      throw new BadRequestException("O preço Stripe precisa estar ativo e ser uma assinatura mensal.");
    }
    if (price.currency.toLowerCase() !== expected.currency.toLowerCase()) {
      throw new BadRequestException("A moeda do preço Stripe não corresponde à moeda do plano.");
    }
    const expectedCents = Math.round(expected.monthlyPrice * 100);
    if (price.unit_amount === null || price.unit_amount !== expectedCents) {
      throw new BadRequestException(
        `O preço Stripe deve ser exatamente ${expected.currency.toUpperCase()} ${(expectedCents / 100).toFixed(2)}.`,
      );
    }
  }

  private async referralCouponId() {
    if (!this.stripe) throw new BadRequestException("Stripe não configurado.");
    const couponId = "chegowia-indicacao-15-3m";
    try {
      const coupon = await this.stripe.coupons.retrieve(couponId);
      if (!coupon.valid || coupon.percent_off !== 15 || coupon.duration !== "repeating" || coupon.duration_in_months !== 3) {
        throw new BadRequestException("O cupom de indicação configurado na Stripe não possui a regra esperada.");
      }
      return coupon.id;
    } catch (error) {
      const stripeError = error as { code?: string };
      if (stripeError.code !== "resource_missing") throw error;
      const coupon = await this.stripe.coupons.create(
        {
          id: couponId,
          percent_off: 15,
          duration: "repeating",
          duration_in_months: 3,
          name: "ChegowIA — indicação (15% por 3 meses)",
        },
        { idempotencyKey: "coupon-chegowia-indicacao-15-3m-v1" },
      );
      return coupon.id;
    }
  }

  private isStripeAccountReady(account: Stripe.Account) {
    return Boolean(
      account.details_submitted
      && account.charges_enabled
      && account.payouts_enabled
      && account.capabilities?.transfers === "active",
    );
  }

  private publicAppUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  private stripeErrorForUser(error: unknown, fallback: string) {
    if (error instanceof Stripe.errors.StripeError) {
      if (error.code === "account_invalid" || error.code === "transfers_not_allowed") {
        return "A conta Stripe ainda não está habilitada para receber repasses. Revise os dados solicitados pela Stripe.";
      }
      if (error.code === "balance_insufficient") {
        return "O saldo disponível na plataforma Stripe ainda não permite este repasse.";
      }
      if (error.type === "StripeConnectionError" || error.type === "StripeAPIError") {
        return "A Stripe está temporariamente indisponível. Tente novamente em alguns instantes.";
      }
      if (error.code === "resource_missing") return "O cadastro solicitado não foi encontrado na Stripe.";
    }
    return fallback;
  }

  private isRetryableStripeError(error: unknown) {
    return (
      error instanceof Stripe.errors.StripeError
      && [
        "StripeAPIError",
        "StripeConnectionError",
        "StripeRateLimitError",
      ].includes(error.type)
    );
  }

  private isMissingStripeResource(error: unknown) {
    return error instanceof Stripe.errors.StripeError && error.code === "resource_missing";
  }

  private stripeErrorForLog(error: unknown) {
    if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
    return String(error);
  }
}

function roundPublicPrice(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function publicUsageDescription(metric: string) {
  const descriptions: Record<string, string> = {
    IA_TOKENS_ENTRADA: "Conteúdo enviado para a IA quando não é reaproveitado do cache.",
    IA_TOKENS_ENTRADA_CACHE: "Trechos de contexto reaproveitados entre conversas pela IA.",
    IA_TOKENS_SAIDA: "Respostas geradas pela IA para clientes e equipe.",
    WHATSAPP_SERVICO: "Mensagens de atendimento enviadas dentro da janela de serviço.",
    WHATSAPP_TEMPLATE_UTILIDADE: "Templates de utilidade, como atualizações de pedido e confirmações.",
    WHATSAPP_TEMPLATE_MARKETING: "Templates promocionais ou de campanha enviados pelo WhatsApp.",
    WHATSAPP_TEMPLATE_AUTENTICACAO: "Templates usados para autenticação e verificação.",
  };
  return descriptions[metric] ?? "Consumo variável registrado conforme o uso da empresa.";
}

function usageMetricLabel(metric: string) {
  const labels: Record<string, string> = {
    IA_TOKENS_ENTRADA: "IA — tokens de entrada",
    IA_TOKENS_ENTRADA_CACHE: "IA — tokens de entrada com cache",
    IA_TOKENS_SAIDA: "IA — tokens de saída",
    WHATSAPP_SERVICO: "WhatsApp — mensagens de serviço",
    WHATSAPP_TEMPLATE_UTILIDADE: "WhatsApp — templates de utilidade",
    WHATSAPP_TEMPLATE_MARKETING: "WhatsApp — templates de marketing",
    WHATSAPP_TEMPLATE_AUTENTICACAO: "WhatsApp — templates de autenticação",
  };
  return labels[metric] ?? metric;
}

function formatUsageQuantity(quantity: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(quantity);
}
