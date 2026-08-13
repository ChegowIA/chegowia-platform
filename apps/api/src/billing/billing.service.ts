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
import { AsaasProvider, AsaasPayment } from "./asaas.provider";
import { UsageService } from "../usage/usage.service";
import { MailService } from "../common/mail/mail.service";
import { runsBackgroundJobs } from "../common/config/app-role";
import { AsaasSubaccountDto } from "./dto/asaas-subaccount.dto";
import { readSecretKey, sealSecret } from "../common/utils/secret-box";

const MAX_PAYOUT_ATTEMPTS = 10;
const MAX_STRIPE_EVENT_ATTEMPTS = 10;
const FREE_TRIAL_DAYS = 7;
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
     * Claim atômico antes de qualquer chamada à Stripe — mesmo padrão de
     * processStripeEvent. Sem isso, dois workers leem o mesmo `attempts`,
     * ambos incrementam e ambos seguem para a transferência: hoje só o
     * idempotencyKey da Stripe segura a duplicata, e ele expira em 24h.
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
      const transferId = viaAsaas
        ? await this.transferPayoutViaAsaas(batch)
        : (await this.stripe!.transfers.create(
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
      const identificacao = viaAsaas ? { asaasTransferId: transferId } : { stripeTransferId: transferId };
      await this.db().$transaction([
        this.db().payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: PayoutBatchStatus.PAGO,
            ...identificacao,
            failureReason: null,
            nextAttemptAt: null,
            completedAt: new Date(),
          },
        }),
        this.db().commissionLedger.updateMany({
          where: {
            payoutBatchId: batch.id,
            status: CommissionStatus.PROCESSANDO,
          },
          data: {
            status: CommissionStatus.PAGA,
            paidAt: new Date(),
            ...identificacao,
          },
        }),
      ]);
      return {
        transferId,
        amount: Number(batch.amount),
        count: batch.commissions.length,
      };
    } catch (error) {
      const safeReason = viaAsaas
        ? this.asaasErrorForUser(error, "Falha ao enviar o repasse.")
        : this.stripeErrorForUser(error, "Falha ao enviar o repasse.");
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
    const existente = await this.asaas.findTransferByReference(referencia).catch(() => null);
    if (existente && existente.status !== "FAILED" && existente.status !== "CANCELLED") {
      this.logger.warn(`Repasse ${batch.id} já tinha transferência ${existente.id} no Asaas; nenhuma nova foi criada.`);
      return existente.id;
    }
    const transferencia = await this.asaas.transferToWallet({
      value: Number(batch.amount),
      walletId: batch.reseller.asaasWalletId!,
      externalReference: referencia,
    });
    return transferencia.id;
  }

  /** Mensagem do Asaas já vem pronta para o usuário; só evitamos vazar texto longo. */
  private asaasErrorForUser(error: unknown, fallback: string) {
    const message = error instanceof HttpException ? error.message : null;
    return message && message.length > 0 && message.length < 300 ? message : fallback;
  }

  private async failPayoutBatch(batchId: string, reason: string) {
    await this.db().$transaction([
      this.db().payoutBatch.update({
        where: { id: batchId },
        data: {
          status: PayoutBatchStatus.FALHOU,
          failureReason: reason,
          nextAttemptAt: null,
          completedAt: new Date(),
        },
      }),
      this.db().commissionLedger.updateMany({
        where: {
          payoutBatchId: batchId,
          status: CommissionStatus.PROCESSANDO,
        },
        data: {
          status: CommissionStatus.DISPONIVEL,
          payoutBatchId: null,
        },
      }),
    ]);
  }

  async companyBillingStatus(companyId: string) {
    const enforcementEnabled = process.env.BILLING_ENFORCEMENT === "true"
      || (process.env.NODE_ENV === "production" && process.env.BILLING_ENFORCEMENT !== "false");
    const now = new Date();
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      include: { plan: true, reseller: { include: { user: { select: { name: true } } } } },
    });
    if (!subscription) {
      const usage = await this.usage.getBillingUsage(companyId, 159.9);
      return {
        status: "SEM_ASSINATURA",
        manageable: false,
        accessRestricted: enforcementEnabled,
        usage,
      };
    }
    const trialActive = this.isTrialActive(subscription, now);
    const trialExpired = this.isTrialExpired(subscription, now);
    const monthlyPrice = this.effectiveSubscriptionMonthlyPrice(subscription);
    // O valor base só compõe uma estimativa quando existe uma assinatura paga.
    // No teste, inclusive depois do vencimento, nenhum dos consumos acumulados
    // pode virar dívida: o cliente escolhe se começa uma nova assinatura.
    const usage = await this.usage.getBillingUsage(
      companyId,
      subscription.status === SubscriptionStatus.ATIVA ? monthlyPrice : 0,
    );
    return {
      status: subscription.status,
      provider: subscription.asaasSubscriptionId ? "ASAAS" : subscription.stripeCustomerId ? "STRIPE" : null,
      manageable: Boolean(subscription.stripeCustomerId || subscription.asaasSubscriptionId),
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
    if (subscription?.asaasSubscriptionId) return this.companyPortalAsaas(subscription);
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
    const cobrancas = await this.asaas.listSubscriptionPayments(subscription.asaasSubscriptionId);
    const emAberto = cobrancas.find((item) => ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"].includes(item.status));
    if (!emAberto?.invoiceUrl) {
      throw new BadRequestException(
        "Não há cobrança em aberto no momento. A próxima fatura fica disponível quando o ciclo virar.",
      );
    }
    return { url: emAberto.invoiceUrl };
  }

  /**
   * Histórico de cobranças para a tela de assinatura. Cada linha traz o link da
   * fatura, que é onde o cliente troca a forma de pagamento — no Asaas o meio é
   * escolhido na hora de pagar, não guardado antes.
   */
  async companyInvoices(companyId: string) {
    const subscription = await this.db().clientSubscription.findUnique({
      where: { companyId },
      select: { asaasSubscriptionId: true, stripeCustomerId: true },
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
            subscription: existing.subscription ?? subscription.asaasSubscriptionId,
            customer: existing.customer,
          });
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
    const hoje = new Date().toISOString().slice(0, 10);

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
    let currentPeriodEnd: Date | null = null;
    if (this.stripe && stripeSubscriptionId) {
      try {
        currentPeriodEnd = this.subscriptionPeriodEnd(await this.stripe.subscriptions.retrieve(stripeSubscriptionId));
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
    const subscription = await this.db().clientSubscription.findUnique({ where: { stripeSubscriptionId }, include: { reseller: true } });
    if (!subscription) return;
    await this.db().clientSubscription.update({ where: { id: subscription.id }, data: { status: SubscriptionStatus.ATIVA } });
    if (!subscription.resellerId || !subscription.reseller?.isActive) return;
    const gross = Number(invoice.amount_paid ?? 0) / 100;
    const rate = Number(subscription.reseller.commissionRate);
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
          grossAmount: -refunded,
          commissionRate: rate,
          commissionAmount: -(Math.round(refunded * rate * 100) / 100),
          currency: charge.currency,
          status: CommissionStatus.DISPONIVEL,
          availableAt: new Date(),
        },
        update: {
          grossAmount: -refunded,
          commissionAmount: -(Math.round(refunded * rate * 100) / 100),
        },
      });
    } else {
      const remainingCommission = Math.max(0, Math.round((Number(original.grossAmount) - refunded) * rate * 100) / 100);
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
      await this.processPendingPayouts();
      if (this.billingProvider() === "ASAAS") {
        await this.reconcilePendingAsaasPayments();
        await this.reconcileOverdueAsaasPayments();
        await this.reconcileOrphanUsage();
        await this.syncVariableUsageToAsaas();
      } else {
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
    if (!this.stripe) return;
    const batches = await this.db().payoutBatch.findMany({
      where: {
        status: PayoutBatchStatus.PROCESSANDO,
        attempts: { lt: MAX_PAYOUT_ATTEMPTS },
        createdAt: { lt: new Date(Date.now() - 10_000) },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: new Date() } },
        ],
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 10,
      select: { id: true },
    }).catch((error: unknown) => {
      this.logger.error(
        "Não foi possível consultar repasses pendentes.",
        this.stripeErrorForLog(error),
      );
      return [];
    });
    for (const batch of batches) {
      await this.executePayoutBatch(batch.id, true).catch((error: unknown) => {
        this.logger.error(
          `Falha ao recuperar o repasse ${batch.id}.`,
          this.stripeErrorForLog(error),
        );
      });
    }
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
          subscription: cobranca.subscription ?? assinatura.asaasSubscriptionId,
          customer: cobranca.customer,
        });
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
      select: { id: true, companyId: true, asaasSubscriptionId: true },
      take: 25,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar assinaturas fora do período pago.", this.stripeErrorForLog(error));
      return [];
    });

    for (const assinatura of vencidas) {
      try {
        const cobrancas = await this.asaas.listSubscriptionPayments(assinatura.asaasSubscriptionId!);
        if (!cobrancas.some((item) => item.status === "OVERDUE")) continue;
        await this.db().clientSubscription.update({
          where: { id: assinatura.id },
          data: { status: SubscriptionStatus.INADIMPLENTE },
        });
        this.logger.warn(
          `Conciliação: empresa ${assinatura.companyId} marcada INADIMPLENTE por cobrança vencida no Asaas.`,
        );
      } catch (error) {
        this.logger.error(
          `Não foi possível conferir vencimento da empresa ${assinatura.companyId}.`,
          this.stripeErrorForLog(error),
        );
      }
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
   * Consumo marcado como faturado em cobrança que não existe mais.
   *
   * Apagar a cobrança no painel dispara `PAYMENT_DELETED`, mas com o webhook
   * desativado esse aviso não chega — e o lançamento fica órfão: contado como
   * cobrado, sem cobrança nenhuma atrás. Ele nunca entraria em fatura e o valor
   * se perderia em silêncio.
   *
   * Só olha lançamento parado há mais de dez minutos, para não disputar com a
   * rotina que acabou de marcá-lo.
   */
  private async reconcileOrphanUsage() {
    const limite = new Date(Date.now() - 10 * 60_000);
    const candidatos = await this.db().usageLedger.findMany({
      where: {
        status: UsageLedgerStatus.SINCRONIZADO,
        asaasPaymentId: { not: null },
        updatedAt: { lt: limite },
      },
      select: { asaasPaymentId: true },
      distinct: ["asaasPaymentId"],
      take: 20,
    }).catch((error: unknown) => {
      this.logger.error("Não foi possível listar consumo já faturado.", this.stripeErrorForLog(error));
      return [];
    });

    for (const item of candidatos) {
      const paymentId = String(item.asaasPaymentId);
      try {
        const cobranca = await this.asaas.findPayment(paymentId);
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

  /** Cobrança desfeita: o consumo volta para a fila e entra na cobrança seguinte. */
  private async returnUsageToQueue(paymentId: string) {
    const devolvidos = await this.db().usageLedger.updateMany({
      where: { asaasPaymentId: paymentId, status: UsageLedgerStatus.SINCRONIZADO },
      data: { status: UsageLedgerStatus.PENDENTE, asaasPaymentId: null },
    }).catch((error: unknown) => {
      this.logger.error(`Não foi possível devolver à fila o consumo da cobrança ${paymentId}.`, this.stripeErrorForLog(error));
      return { count: 0 };
    });
    if (devolvidos.count) {
      this.logger.log(`Cobrança ${paymentId} apagada: ${devolvidos.count} lançamento(s) de consumo voltaram para a fila.`);
    }
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
   * reconhecido e `PAYMENT_RECEIVED` quando o dinheiro entra; para liberar o
   * acesso o primeiro basta, e tratar os dois deixa o cliente esperando menos.
   */
  private async applyAsaasEvent(payload: any) {
    const evento = String(payload?.event ?? "");
    const cobranca = payload?.payment;
    if (!cobranca?.id) return;

    if (evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED") {
      // Não emitimos mais cobrança avulsa de consumo, mas as que já saíram antes
      // dessa regra continuam existindo. Tratá-las como mensalidade paga
      // renovaria o vínculo do revendedor e pagaria comissão sobre elas.
      if (String(cobranca.externalReference ?? "").startsWith("usage-")) {
        await this.markAsaasUsagePaid(String(cobranca.id));
        return;
      }
      await this.activateFromAsaasPayment(cobranca);
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
    // Os três caminhos pelos quais um dinheiro já recebido volta atrás. Não
    // existe `PAYMENT_REVERSED` no Asaas — o desfazimento de recebimento em
    // dinheiro é que ocupa esse lugar.
    if (
      evento === "PAYMENT_REFUNDED"
      || evento === "PAYMENT_CHARGEBACK_REQUESTED"
      || evento === "PAYMENT_RECEIVED_IN_CASH_UNDONE"
    ) {
      await this.reverseAsaasCommission(cobranca);
      await this.markAsaasSubscriptionStatus(cobranca, SubscriptionStatus.INADIMPLENTE);
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

  /** Localiza a assinatura da plataforma a partir da cobrança do Asaas. */
  private async subscriptionFromAsaas(cobranca: any) {
    if (cobranca.subscription) {
      const porAssinatura = await this.db().clientSubscription.findUnique({
        where: { asaasSubscriptionId: String(cobranca.subscription) },
        include: { reseller: true },
      });
      if (porAssinatura) return porAssinatura;
    }
    // Cobrança avulsa (ativação criada antes da assinatura, por exemplo).
    if (cobranca.customer) {
      return this.db().clientSubscription.findUnique({
        where: { asaasCustomerId: String(cobranca.customer) },
        include: { reseller: true },
      });
    }
    return null;
  }

  private async activateFromAsaasPayment(cobranca: any) {
    const assinatura = await this.subscriptionFromAsaas(cobranca);
    if (!assinatura) {
      this.logger.warn(`Cobrança ${cobranca.id} paga no Asaas sem assinatura correspondente.`);
      return;
    }

    const agora = new Date();
    // Fim do período pago. Sem isso o painel mostraria período vazio e a
    // detecção de vencimento não teria por onde filtrar.
    const fimDoPeriodo = new Date(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());
    await this.db().clientSubscription.update({
      where: { id: assinatura.id },
      data: {
        status: SubscriptionStatus.ATIVA,
        currentPeriodEnd: fimDoPeriodo,
        asaasSubscriptionId: cobranca.subscription
          ? String(cobranca.subscription)
          : assinatura.asaasSubscriptionId,
        // A cobrança foi paga: deixa de estar em aberto.
        asaasPaymentId: null,
        canceledAt: null,
        // O desconto por indicação começa com a assinatura paga, não no teste.
        discountEndsAt: assinatura.resellerId && !assinatura.discountEndsAt
          ? new Date(agora.getFullYear(), agora.getMonth() + 3, agora.getDate())
          : assinatura.discountEndsAt,
      },
    });
    await this.recordAsaasCommission(assinatura, cobranca);
  }

  private async markAsaasSubscriptionStatus(cobranca: any, status: SubscriptionStatus) {
    const assinatura = await this.subscriptionFromAsaas(cobranca);
    if (!assinatura) return;
    await this.db().clientSubscription.update({
      where: { id: assinatura.id },
      data: { status },
    });
  }

  /**
   * Comissão do revendedor. Nasce pendente e só fica disponível após a carência,
   * que existe para cobrir estorno e contestação — por isso não usamos o split
   * do Asaas, que repassaria no ato.
   */
  private async recordAsaasCommission(assinatura: any, cobranca: any) {
    if (!assinatura.resellerId || !assinatura.reseller?.isActive) return;

    const bruto = Number(cobranca.value ?? 0);
    if (!bruto) return;
    const taxa = Number(assinatura.reseller.commissionRate);
    const carenciaDias = Math.max(0, Number(process.env.COMMISSION_HOLD_DAYS ?? process.env.STRIPE_COMMISSION_HOLD_DAYS ?? 7));
    const disponivelEm = new Date(Date.now() + carenciaDias * 24 * 60 * 60 * 1000);

    await this.db().commissionLedger.upsert({
      // O id da cobrança é único: reprocessar o mesmo evento não duplica lançamento.
      where: { asaasPaymentId: String(cobranca.id) },
      create: {
        resellerId: assinatura.resellerId,
        subscriptionId: assinatura.id,
        asaasPaymentId: String(cobranca.id),
        grossAmount: bruto,
        commissionRate: taxa,
        commissionAmount: Math.round(bruto * taxa * 100) / 100,
        currency: "brl",
        status: carenciaDias === 0 ? CommissionStatus.DISPONIVEL : CommissionStatus.PENDENTE,
        availableAt: disponivelEm,
      },
      update: {},
    });
  }

  /** Estorno depois de paga: a comissão daquele mês deixa de ser devida. */
  private async reverseAsaasCommission(cobranca: any) {
    await this.db().commissionLedger.updateMany({
      where: {
        asaasPaymentId: String(cobranca.id),
        status: { in: [CommissionStatus.PENDENTE, CommissionStatus.DISPONIVEL] },
      },
      data: { status: CommissionStatus.ESTORNADA },
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
    await this.db().commissionLedger.updateMany({
      where: {
        ...(resellerId ? { resellerId } : {}),
        status: CommissionStatus.PENDENTE,
        availableAt: { lte: new Date() },
      },
      data: { status: CommissionStatus.DISPONIVEL },
    });
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
