import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ApplicationStatus, CommissionStatus, LeadStatus, Prisma, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { AI_PROVIDER, AIProvider } from "../ai/providers/ai-provider.interface";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { normalizeBrazilDocument } from "../common/validators/brazil-document.validator";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateProspectDto } from "./dto/create-prospect.dto";
import { ResellerApplicationDto } from "./dto/reseller-application.dto";
import { LocalStorageService } from "../common/storage/local-storage.service";
import { AuthService } from "../auth/auth.service";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";

@Injectable()
export class ResellersService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
    private readonly realtime: RealtimeGateway,
    private readonly storage: LocalStorageService,
    private readonly auth: AuthService,
  ) {}

  private db() { return this.prisma as any; }

  private commissionLifecycle(item: any) {
    if (item.status === CommissionStatus.DISPONIVEL) {
      return Number(item.commissionAmount) < 0
        ? { code: "AJUSTE", label: "Ajuste de estorno", detail: "Será compensado nos próximos valores disponíveis." }
        : { code: "DISPONIVEL", label: "Liberado para saque", detail: "O saldo já foi recebido pelo Asaas e pode ser repassado." };
    }
    if (item.status === CommissionStatus.PROCESSANDO) {
      return { code: "PROCESSANDO", label: "Repasse em processamento", detail: "A transferência para sua conta Asaas está sendo confirmada." };
    }
    if (item.status === CommissionStatus.PAGA) {
      return { code: "PAGA", label: "Repassada", detail: "A transferência foi confirmada." };
    }
    if (item.status === CommissionStatus.ESTORNADA) {
      return { code: "ESTORNADA", label: "Estornada", detail: "O pagamento do cliente foi desfeito; não há comissão neste ciclo." };
    }
    if (item.holdReason === "CONTESTACAO_DE_PAGAMENTO") {
      return { code: "EM_ANALISE", label: "Em análise pelo Asaas", detail: "O saque fica suspenso até a resolução da contestação." };
    }
    if (item.availableAt && new Date(item.availableAt).getTime() > Date.now()) {
      return { code: "RESERVA", label: "Reserva de segurança", detail: "O crédito já ocorreu; aguardamos a reserva configurada pela plataforma." };
    }
    return { code: "EM_COMPENSACAO", label: "Em compensação", detail: "O pagamento foi confirmado, mas o Asaas ainda não creditou o valor na conta raiz." };
  }

  async apply(dto: ResellerApplicationDto, file?: any) {
    if (!file) throw new BadRequestException("Envie seu currículo em PDF, DOC ou DOCX.");
    const normalizedEmail = dto.email.trim().toLowerCase();
    const normalizedDocument = normalizeBrazilDocument(dto.document);
    if (await this.db().user.findUnique({ where: { email: normalizedEmail } })) {
      throw new ConflictException("Este e-mail já possui uma conta.");
    }
    const [documentUser, documentCompany] = await Promise.all([
      this.db().user.findUnique({ where: { document: normalizedDocument } }),
      this.db().company.findUnique({ where: { cnpj: normalizedDocument } }),
    ]);
    if (documentUser || documentCompany) throw new ConflictException("Este CPF/CNPJ já está vinculado a uma conta.");
    const previous = await this.db().resellerApplication.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "desc" },
    });
    if (previous?.status === ApplicationStatus.APROVADA) throw new ConflictException("Candidatura já aprovada.");
    const attemptCount = (previous?.attemptCount ?? 0) + 1;
    if (attemptCount > 3) throw new BadRequestException("As três tentativas foram utilizadas. Sua candidatura aguarda análise humana.");

    const resumeUrl = await this.storage.savePrivateDocument(
      file,
      "resumes",
      normalizedDocument,
    );
    let application: any;
    try {
      application = await this.db().resellerApplication.create({
        data: {
          fullName: dto.fullName.trim(),
          email: normalizedEmail,
          phone: dto.phone,
          document: normalizedDocument,
          city: dto.city,
          state: dto.state.toUpperCase(),
          linkedinUrl: dto.linkedinUrl || null,
          resumeUrl,
          resumeText: dto.resumeText,
          motivation: dto.motivation,
          commitment: dto.commitment,
          experience: dto.experience || null,
          passwordHash: await bcrypt.hash(dto.password, 12),
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
          automatedAnalysisAcceptedAt: new Date(),
          attemptCount,
        },
      });
    } catch (error) {
      await this.storage.removePrivateFile(resumeUrl);
      throw error;
    }
    return this.evaluate(application);
  }

  async applicationStatus(id: string) {
    const item = await this.db().resellerApplication.findUnique({
      where: { id },
      select: { id: true, status: true, attemptCount: true, aiScore: true, aiFeedback: true, createdAt: true, updatedAt: true },
    });
    if (!item) throw new NotFoundException("Candidatura não encontrada.");
    return item;
  }

  private async evaluate(application: any) {
    let analysis: any;
    try {
      // Custo da plataforma: esta análise é do processo comercial da ChegowIA,
      // anterior à existência da empresa. Não há a quem atribuir consumo.
      const result = await this.ai.chat([
        {
          role: "system",
          content:
            "Você avalia candidatos a revendedor de software SaaS. Não discrimine por idade, gênero, raça, religião, deficiência ou origem. Avalie apenas clareza de comunicação, experiência comercial/atendimento, entendimento de recorrência, ética, disponibilidade e comprometimento demonstrado. Responda JSON puro: {\"score\":0-100,\"decision\":\"APPROVE\"|\"REJECT\",\"feedback\":\"orientação objetiva\",\"strengths\":[\"\"],\"risks\":[\"\"]}. Aprove com score >= 70 e sem risco ético grave.",
        },
        {
          role: "user",
          content: `Currículo resumido:\n${application.resumeText}\n\nExperiência:\n${application.experience ?? "Não informada"}\n\nMotivação:\n${application.motivation}\n\nComprometimento:\n${application.commitment}`,
        },
      ]);
      analysis = JSON.parse((result.content ?? "").replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      analysis = { score: null, decision: "HUMAN", feedback: "A análise automática ficou indisponível; encaminhamos para revisão humana.", risks: ["Falha técnica na análise"] };
    }

    const approved = analysis.decision === "APPROVE" && Number(analysis.score) >= 70;
    if (approved) {
      const reseller = await this.approveApplication(application.id, undefined, "Aprovado automaticamente pela análise assistida.");
      return { applicationId: application.id, status: ApplicationStatus.APROVADA, attemptCount: application.attemptCount, aiScore: analysis.score, aiFeedback: analysis.feedback, accessCreated: true, resellerCode: reseller.code };
    }
    const status = application.attemptCount >= 3 || analysis.decision === "HUMAN"
      ? ApplicationStatus.REVISAO_HUMANA
      : ApplicationStatus.RECUSADA_IA;
    await this.db().resellerApplication.update({
      where: { id: application.id },
      data: { status, aiScore: analysis.score, aiDecision: analysis.decision, aiFeedback: analysis.feedback, aiAnalysis: analysis },
    });
    return { applicationId: application.id, status, attemptCount: application.attemptCount, attemptsRemaining: Math.max(0, 3 - application.attemptCount), aiScore: analysis.score, aiFeedback: analysis.feedback };
  }

  async listApplications(status?: ApplicationStatus) {
    return this.db().resellerApplication.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      select: {
        id: true, fullName: true, email: true, phone: true, document: true, city: true, state: true,
        linkedinUrl: true, resumeUrl: true, resumeText: true, motivation: true, commitment: true,
        experience: true, status: true, attemptCount: true, aiScore: true, aiFeedback: true,
        aiAnalysis: true, reviewNotes: true, createdAt: true,
      },
    });
  }

  /** Diretório de parceiros já aprovados, usado só pela central da plataforma. */
  async listProfiles(query: PaginationQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.ResellerProfileWhereInput = search
      ? {
          OR: [
            { code: { contains: search } },
            { user: { is: { name: { contains: search } } } },
            { user: { is: { email: { contains: search } } } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db().resellerProfile.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          code: true,
          isActive: true,
          approvedAt: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, isActive: true, createdAt: true } },
          _count: { select: { subscriptions: true, commissions: true, prospects: true, leads: true } },
        },
      }),
      this.db().resellerProfile.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async resume(id: string) {
    const application = await this.db().resellerApplication.findUnique({ where: { id }, select: { resumeUrl: true } });
    if (!application?.resumeUrl) throw new NotFoundException("Currículo não encontrado.");
    return this.storage.readPrivateFile(application.resumeUrl);
  }

  async humanReview(id: string, approve: boolean, notes: string | undefined, reviewerId: string) {
    const application = await this.db().resellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException("Candidatura não encontrada.");
    if (application.status === ApplicationStatus.APROVADA) throw new BadRequestException("Candidatura já aprovada.");
    if (approve) return this.approveApplication(id, reviewerId, notes || "Aprovado em revisão humana.");
    return this.db().resellerApplication.update({
      where: { id },
      data: { status: ApplicationStatus.RECUSADA, reviewNotes: notes, reviewedByUserId: reviewerId, reviewedAt: new Date() },
    });
  }

  private async approveApplication(id: string, reviewerId?: string, notes?: string) {
    const application = await this.db().resellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException("Candidatura não encontrada.");
    const existing = await this.db().user.findUnique({ where: { email: application.email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");
    const [documentUser, documentCompany] = await Promise.all([
      this.db().user.findUnique({ where: { document: application.document } }),
      this.db().company.findUnique({ where: { cnpj: application.document } }),
    ]);
    if (documentUser || documentCompany) throw new ConflictException("Este CPF/CNPJ já está vinculado a uma conta.");
    const code = await this.uniqueCode(application.fullName);
    let reseller: any;
    try {
      reseller = await this.db().$transaction(async (tx: any) => {
        const user = await tx.user.create({
          data: {
            name: application.fullName,
            email: application.email,
            document: application.document,
            passwordHash: application.passwordHash,
            role: Role.REVENDEDOR,
            termsAcceptedAt: application.termsAcceptedAt,
            privacyAcceptedAt: application.privacyAcceptedAt,
          },
        });
        await tx.identityDocument.create({
          data: { value: application.document, ownerType: "USER", ownerId: user.id },
        });
        const created = await tx.resellerProfile.create({
          data: { userId: user.id, applicationId: id, code },
        });
        await tx.resellerApplication.update({
          where: { id },
          data: {
            status: ApplicationStatus.APROVADA,
            reviewNotes: notes,
            reviewedByUserId: reviewerId,
            reviewedAt: new Date(),
            aiDecision: reviewerId ? application.aiDecision : "APPROVE",
          },
        });
        return created;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        throw new ConflictException(
          "O e-mail, CPF/CNPJ ou código desta candidatura já está vinculado a outra conta.",
        );
      }
      throw error;
    }
    await this.auth.sendVerificationForUser(reseller.userId);
    return reseller;
  }

  async dashboard(userId: string, includeInactive = false, readOnly = false) {
    const reseller = await this.profile(userId, includeInactive);
    // A leitura do suporte não pode liberar comissão nem alterar o extrato de
    // outra pessoa. A rotina continua ocorrendo normalmente nas sessões do
    // próprio parceiro e nos processos financeiros de fundo.
    if (!readOnly) {
      await this.db().commissionLedger.updateMany({
        where: {
          resellerId: reseller.id,
          status: CommissionStatus.PENDENTE,
          availableAt: { lte: new Date() },
        },
        data: { status: CommissionStatus.DISPONIVEL },
      });
    }
    const [commissions, activeSubscriptions, prospects, leads] = await Promise.all([
      this.db().commissionLedger.findMany({
        where: { resellerId: reseller.id },
        orderBy: { createdAt: "desc" },
        // O painel só precisa dos nomes. Nunca devolva configuração de
        // empresa, IDs de provedor ou segredos por meio do extrato.
        include: {
          subscription: {
            select: {
              company: { select: { name: true } },
              plan: { select: { name: true } },
            },
          },
        },
        take: 50,
      }),
      this.db().clientSubscription.count({ where: { resellerId: reseller.id, status: "ATIVA" } }),
      this.db().resellerProspect.count({ where: { resellerId: reseller.id } }),
      this.db().salesLead.count({ where: { resellerId: reseller.id, status: LeadStatus.EM_ATENDIMENTO } }),
    ]);
    // Sem gravar no banco, a visão de suporte ainda reflete valores que já
    // venceram a janela de reserva. Assim a inspeção não mostra um saldo
    // artificialmente defasado só por ser read-only.
    const visibleSource = readOnly
      ? commissions.map((item: any) => (
          item.status === CommissionStatus.PENDENTE
          && item.availableAt
          && new Date(item.availableAt).getTime() <= Date.now()
            ? { ...item, status: CommissionStatus.DISPONIVEL }
            : item
        ))
      : commissions;
    const total = (items: any[]) => items.reduce((sum: number, item: any) => sum + Number(item.commissionAmount), 0);
    const available = total(visibleSource.filter((item: any) => item.status === CommissionStatus.DISPONIVEL));
    const paid = total(visibleSource.filter((item: any) => item.status === CommissionStatus.PAGA));
    const pendingSettlement = total(visibleSource.filter((item: any) => {
      const lifecycle = this.commissionLifecycle(item);
      return lifecycle.code === "EM_COMPENSACAO";
    }));
    const underReview = total(visibleSource.filter((item: any) => this.commissionLifecycle(item).code === "EM_ANALISE"));
    const safetyHold = total(visibleSource.filter((item: any) => this.commissionLifecycle(item).code === "RESERVA"));
    const processing = total(visibleSource.filter((item: any) => item.status === CommissionStatus.PROCESSANDO));
    const visibleCommissions = visibleSource.map((item: any) => ({
      ...item,
      lifecycle: this.commissionLifecycle(item),
      // Transparência: a base é a mensalidade do plano, e não o total de uma
      // fatura que possa conter IA ou WhatsApp.
      commissionBase: Number(item.grossAmount),
      commissionRatePercent: Math.round(Number(item.commissionRate) * 10000) / 100,
    }));
    return {
      profile: reseller,
      balances: { available, paid, pendingSettlement, underReview, safetyHold, processing },
      commissionPolicy: {
        trialDays: 7,
        commissionRatePercent: 30,
        appliesTo: "Somente à mensalidade do plano; consumo de IA e WhatsApp não entra na comissão.",
        releaseRule: "A comissão é liberada depois que o Asaas registra o recebimento ou confirma o crédito de uma antecipação automática elegível.",
        settlementNotice: "O pagamento pode aparecer como confirmado antes de o saldo ficar disponível: confirmado quer dizer que o cliente pagou, e o saque só abre quando o dinheiro entra na conta. Quem escolhe a forma de pagamento é o cliente, então o prazo abaixo é dele, não seu.",
        /**
         * Prazos de compensação do Asaas, contados a partir do pagamento do
         * cliente. São previsão, não promessa: quem abre o saque é o aviso de
         * crédito do próprio Asaas, e antecipação automática elegível encurta
         * o prazo do cartão.
         */
        settlementSchedule: [
          { method: "Pix", eta: "no mesmo dia", detail: "Cai em segundos, inclusive fim de semana." },
          { method: "Boleto", eta: "1 a 2 dias úteis", detail: "Depende da compensação bancária." },
          { method: "Cartão de débito", eta: "até 3 dias úteis", detail: "Compensa só em dia útil." },
          { method: "Cartão de crédito", eta: "32 dias corridos", detail: "É o prazo padrão do Asaas; com antecipação elegível, sai antes." },
        ],
      },
      activeSubscriptions,
      prospects,
      activeLeads: leads,
      commissions: visibleCommissions,
    };
  }

  async listProspects(userId: string, includeInactive = false) {
    const reseller = await this.profile(userId, includeInactive);
    return this.db().resellerProspect.findMany({ where: { resellerId: reseller.id }, orderBy: { updatedAt: "desc" } });
  }

  async createProspect(userId: string, dto: CreateProspectDto) {
    const reseller = await this.profile(userId);
    return this.db().resellerProspect.create({ data: { resellerId: reseller.id, ...dto, stage: dto.stage || "NOVO" } });
  }

  async availableLeads(userId: string, includeInactive = false, onlyOwned = false) {
    const reseller = await this.profile(userId, includeInactive);
    const mine = await this.db().salesLead.findMany({
      where: { resellerId: reseller.id },
      orderBy: { createdAt: "desc" },
    });
    if (onlyOwned) return mine;
    const available = await this.db().salesLead.findMany({
      where: { status: LeadStatus.DISPONIVEL },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, companyName: true, city: true, state: true, message: true, status: true, createdAt: true },
    });
    return [...available, ...mine];
  }

  async claimLead(userId: string, leadId: string) {
    const reseller = await this.profile(userId);
    const claimed = await this.db().salesLead.updateMany({
      where: { id: leadId, status: LeadStatus.DISPONIVEL, resellerId: null },
      data: { status: LeadStatus.EM_ATENDIMENTO, resellerId: reseller.id, claimedByUserId: userId, claimedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException("Outro revendedor já assumiu este contato.");
    const lead = await this.db().salesLead.findUnique({ where: { id: leadId } });
    this.realtime.emitToResellers("lead.claimed", { leadId, resellerId: reseller.id });
    return lead;
  }

  async updateLeadStatus(userId: string, leadId: string, status: LeadStatus) {
    const reseller = await this.profile(userId);
    const lead = await this.db().salesLead.findFirst({ where: { id: leadId, resellerId: reseller.id } });
    if (!lead) throw new NotFoundException("Lead não encontrado na sua carteira.");
    if (lead.status === LeadStatus.CONVERTIDO) {
      throw new BadRequestException("Uma venda confirmada não pode voltar para outra etapa.");
    }
    const allowed: Record<string, LeadStatus[]> = {
      [LeadStatus.EM_ATENDIMENTO]: [LeadStatus.PROPOSTA, LeadStatus.PERDIDO],
      [LeadStatus.PROPOSTA]: [
        LeadStatus.EM_ATENDIMENTO,
        LeadStatus.CONVERTIDO,
        LeadStatus.PERDIDO,
      ],
      [LeadStatus.PERDIDO]: [LeadStatus.EM_ATENDIMENTO],
    };
    if (!(allowed[lead.status] ?? []).includes(status)) {
      throw new BadRequestException("Mudança de etapa não permitida para este lead.");
    }
    return this.db().salesLead.update({
      where: { id: lead.id },
      data: { status, convertedAt: status === LeadStatus.CONVERTIDO ? new Date() : null },
    });
  }

  async createLead(dto: CreateLeadDto) {
    const recent = await this.db().salesLead.findFirst({
      where: { email: dto.email.toLowerCase(), createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
    });
    if (recent) return { id: recent.id, received: true };
    const lead = await this.db().salesLead.create({ data: { ...dto, email: dto.email.toLowerCase() } });
    // A sala `resellers` alcança TODOS os revendedores conectados, inclusive os
    // que não vão assumir este lead. Emitir o registro inteiro distribuiria
    // e-mail e telefone da pessoa para a rede toda — o contato completo só é
    // liberado a quem reivindica o lead (ver `claimLead`). Projeção idêntica à
    // usada em `availableLeads`, que já omite PII de propósito.
    this.realtime.emitToResellers("lead.available", {
      id: lead.id,
      name: lead.name,
      companyName: lead.companyName,
      city: lead.city,
      state: lead.state,
      message: lead.message,
      status: lead.status,
      createdAt: lead.createdAt,
    });
    return { id: lead.id, received: true };
  }

  async assistant(userId: string, message: string) {
    const [dashboard, prospects, leads] = await Promise.all([
      this.dashboard(userId),
      this.listProspects(userId),
      this.availableLeads(userId),
    ]);
    const context = {
      resellerCode: dashboard.profile.code,
      availableBalance: dashboard.balances.available,
      paidBalance: dashboard.balances.paid,
      activeSubscriptions: dashboard.activeSubscriptions,
      prospectCount: dashboard.prospects,
      activeLeadCount: dashboard.activeLeads,
      prospects: prospects.slice(0, 15).map((item: any) => ({
        name: item.name,
        companyName: item.companyName,
        stage: item.stage,
        city: item.city,
        state: item.state,
      })),
      leads: leads.slice(0, 15).map((item: any) => ({
        name: item.name,
        companyName: item.companyName,
        status: item.status,
        city: item.city,
        state: item.state,
      })),
    };

    try {
      // Custo da plataforma: o assistente é do revendedor, que não é uma
      // empresa cliente e não tem fatura de consumo. Cobrar isso de alguma
      // loja seria cobrá-la pelo trabalho de quem a vendeu.
      const result = await this.ai.chat([
        {
          role: "system",
          content: [
            "Você é o assistente comercial do painel de revendedores da ChegowIA.",
            "Responda em português do Brasil, com clareza, objetividade e tom de parceiro comercial experiente.",
            "Ajude a organizar leads e prospects, preparar abordagem, explicar comissão, código de revendedor, saldo e próximos passos.",
            "A comissão do revendedor é de 30% somente da mensalidade do plano: nasce após os 7 dias de teste, fica em compensação quando o pagamento é confirmado e só entra em saque quando o Asaas informa o crédito recebido.",
            "O cliente que vincula um código válido recebe 15% de desconto nos primeiros 3 meses. O vínculo não pode ser trocado enquanto a conta estiver ativa.",
            "Não invente contatos, valores, pagamentos, vendas ou dados ausentes. Não prometa aprovação, saque ou conversão.",
            "Não exponha dados de outros revendedores. Não execute mudanças: apenas oriente com base no contexto fornecido.",
            `Contexto atual do revendedor:\n${JSON.stringify(context)}`,
          ].join("\n\n"),
        },
        { role: "user", content: message.trim() },
      ]);
      return { content: result.content?.trim() || this.resellerAssistantFallback(message, context) };
    } catch {
      return { content: this.resellerAssistantFallback(message, context) };
    }
  }

  private resellerAssistantFallback(message: string, context: any) {
    const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes("saldo") || normalized.includes("comissao")) {
      return `Seu saldo disponível é R$ ${Number(context.availableBalance).toFixed(2).replace(".", ",")} e o total já pago é R$ ${Number(context.paidBalance).toFixed(2).replace(".", ",")}. Você recebe 30% da mensalidade do plano dos clientes vinculados ao seu código, depois dos 7 dias de teste e da confirmação de crédito pelo Asaas.`;
    }
    if (normalized.includes("codigo") || normalized.includes("desconto")) {
      return `Seu código é **${context.resellerCode}**. O cliente recebe 15% de desconto nos 3 primeiros meses, e o vínculo com o revendedor permanece enquanto a conta estiver ativa.`;
    }
    if (normalized.includes("lead") || normalized.includes("cliente") || normalized.includes("prospect")) {
      return `Você tem ${context.activeLeadCount} lead(s) em atendimento, ${context.prospectCount} prospect(s) cadastrados e ${context.activeSubscriptions} assinatura(s) ativa(s). Posso ajudar a montar uma abordagem ou priorizar o próximo contato.`;
    }
    return `Estou aqui para apoiar suas vendas. Posso resumir sua carteira, explicar saldo e comissão, ajudar com uma abordagem ou organizar os próximos contatos.`;
  }

  private async profile(userId: string, includeInactive = false) {
    // Este objeto volta no dashboard. Seleção explícita impede que a chave
    // cifrada da subconta Asaas (e outros identificadores financeiros) escape
    // para o navegador, inclusive na visão do superadmin.
    const profile = await this.db().resellerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        code: true,
        commissionRate: true,
        isActive: true,
        approvedAt: true,
        createdAt: true,
        user: { select: { name: true, email: true, isActive: true } },
      },
    });
    if (!profile || (!includeInactive && !profile.isActive)) {
      throw new NotFoundException("Perfil de revendedor não encontrado ou inativo.");
    }
    return profile;
  }

  private async uniqueCode(name: string) {
    const root = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "CHEGOWIA";
    for (let index = 0; index < 20; index += 1) {
      const code = `${root}${Math.floor(1000 + Math.random() * 9000)}`;
      if (!(await this.db().resellerProfile.findUnique({ where: { code } }))) return code;
    }
    return `CW${Date.now().toString(36).toUpperCase()}`;
  }

}
