import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AccountTokenType, Role } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { JwtPayload, SuperAdminSupportAccessKind } from "../common/interfaces/jwt-payload.interface";
import { MailService } from "../common/mail/mail.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { isReservedDemoEmail } from "../common/security/reserved-demo-account";

interface IssuedTokens {
  accessToken: string;
  refreshTokenCookie: string;
  refreshTokenExpiresAt: Date;
}

/** Papel e empresa que o superadmin multiacesso decidiu assumir nesta sessão. */
interface AssumedContext {
  role: Role;
  companyId: string | null;
  companyName?: string | null;
  /** Presente somente quando a sessão nasceu de um atalho de suporte auditado. */
  accessId?: string | null;
  accessKind?: SuperAdminSupportAccessKind | null;
  /** Só é preenchido para visualizar a conta concreta de um revendedor. */
  subjectUserId?: string | null;
  resellerId?: string | null;
  resellerName?: string | null;
  /** Limite curto da sessão de suporte; contextos manuais mantêm a regra normal. */
  expiresAt?: Date | null;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MFA_TTL_MS = 10 * 60 * 1000;
const SUPER_ADMIN_ACCESS_LINK_TTL_MS = 10 * 60 * 1000;
const SUPER_ADMIN_ASSUMED_SESSION_TTL_MS = 60 * 60 * 1000;
const EMPLOYEE_ROLES: Role[] = [Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private db() {
    return this.prisma as any;
  }

  private toPayload(
    user: { id: string; email: string; role: Role; companyId: string | null },
    assumed?: AssumedContext | null,
  ): JwtPayload {
    if (assumed) {
      // `sub` continua sendo o usuário real: é o que permite auditar quem agiu
      // dentro da empresa assumida.
      return {
        sub: user.id,
        email: user.email,
        role: assumed.role,
        companyId: assumed.companyId,
        assumed: true,
        ...(assumed.accessId
          ? {
            assumedAccessId: assumed.accessId,
            assumedAccessKind: assumed.accessKind ?? "COMPANY",
            ...(assumed.subjectUserId ? { assumedUserId: assumed.subjectUserId } : {}),
            ...(assumed.resellerId ? { assumedResellerId: assumed.resellerId } : {}),
          }
          : {}),
      };
    }
    return { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
  }

  private async issueTokens(
    user: { id: string; email: string; role: Role; companyId: string | null },
    assumed?: AssumedContext | null,
  ): Promise<IssuedTokens> {
    const accessToken = this.jwtService.sign(this.toPayload(user, assumed), {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as any,
      issuer: process.env.JWT_ISSUER ?? "chegowia-api",
      audience: process.env.JWT_AUDIENCE ?? "chegowia-web",
    });

    const secret = randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(secret, 10);
    const defaultExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const expiresAt = assumed?.expiresAt && assumed.expiresAt < defaultExpiresAt
      ? assumed.expiresAt
      : defaultExpiresAt;

    const record = await this.db().refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        assumedRole: assumed?.role ?? null,
        assumedCompanyId: assumed?.companyId ?? null,
        assumedAccessId: assumed?.accessId ?? null,
        assumedAccessKind: assumed?.accessKind ?? null,
        assumedUserId: assumed?.subjectUserId ?? null,
        assumedResellerId: assumed?.resellerId ?? null,
      },
    });

    return {
      accessToken,
      refreshTokenCookie: `${record.id}.${secret}`,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async validateUser(email: string, password: string) {
    const user = await this.db().user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.isActive) throw new UnauthorizedException("Credenciais inválidas.");
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException("Credenciais inválidas.");
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        "Confirme seu e-mail antes de entrar. Se necessário, solicite um novo link de confirmação.",
      );
    }

    /**
     * Empresa desativada barra a entrada de quem trabalha nela.
     *
     * O `AccountStatusGuard` já recusava toda requisição dessa empresa, mas o
     * login continuava emitindo token: a pessoa entrava, o painel abria e cada
     * consulta voltava 403. Na tela isso parece "consigo acessar normalmente" —
     * e o super administrador que desativou a conta acredita que a desativação
     * não funcionou.
     *
     * O acesso de suporte não passa por aqui: ele é consumido por link próprio,
     * e precisa continuar funcionando justamente quando a empresa está inativa.
     */
    if (AuthService.COMPANY_ROLES.includes(user.role) && user.companyId) {
      const company = await this.db().company.findUnique({
        where: { id: user.companyId },
        select: { isActive: true },
      });
      if (!company?.isActive) {
        throw new UnauthorizedException(
          "A conta da sua empresa está desativada. Fale com o suporte da ChegowIA.",
        );
      }
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    if (this.requiresMfa(user.role)) {
      await this.db().accountToken.updateMany({
        where: {
          userId: user.id,
          type: AccountTokenType.LOGIN_MFA,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      const code = String(randomInt(100000, 1_000_000));
      const challenge = await this.db().accountToken.create({
        data: {
          userId: user.id,
          type: AccountTokenType.LOGIN_MFA,
          tokenHash: await bcrypt.hash(code, 10),
          expiresAt: new Date(Date.now() + MFA_TTL_MS),
        },
      });
      await this.mail.sendMfaCode(user.email, user.name, code);
      return {
        mfaRequired: true as const,
        challengeId: challenge.id,
        emailHint: this.maskEmail(user.email),
      };
    }
    const tokens = await this.issueTokens(user);
    return {
      ...tokens,
      mfaRequired: false as const,
      user: await this.publicUser(user),
      // O painel usa isto para abrir o seletor de contexto logo após entrar.
      multiContext: this.isMultiContextUser(user),
    };
  }

  // ---------------------------------------------------------------------------
  // Login multiacesso do superadmin
  // ---------------------------------------------------------------------------

  /**
   * Um único e-mail, definido por ambiente, pode escolher com que papel entrar.
   * Vive em variável de ambiente justamente para não virar um privilégio que se
   * concede pelo painel: mudar quem tem esse poder exige acesso ao servidor.
   */
  private multiContextEmail() {
    return (process.env.MULTI_CONTEXT_LOGIN_EMAIL ?? "").trim().toLowerCase();
  }

  private isMultiContextUser(user: { email: string; role: Role }) {
    const allowed = this.multiContextEmail();
    return Boolean(allowed) && user.role === Role.SUPER_ADMIN && user.email.trim().toLowerCase() === allowed;
  }

  /**
   * Papéis que o multiacesso pode assumir dentro de uma empresa. A ordem é a de
   * uso: administrar, atender, produzir, entregar, servir.
   */
  private static readonly COMPANY_ROLES: Role[] = [
    Role.ADMIN,
    Role.FUNCIONARIO,
    Role.COZINHA,
    Role.MOTOBOY,
    Role.GARCOM,
  ];

  /**
   * Contextos que este usuário pode assumir: a plataforma, cada papel dentro de
   * cada empresa ativa e a visão pública de cliente. Revendedor não aparece
   * aqui porque não existe uma carteira genérica: a central de parceiros abre
   * sempre um perfil concreto, auditado e read-only.
   */
  async availableContexts(identity: JwtPayload) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || !this.isMultiContextUser(user)) {
      return { multiContext: false as const, contexts: [] };
    }
    const companies = await this.db().company.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
    return {
      multiContext: true as const,
      companyRoles: AuthService.COMPANY_ROLES,
      contexts: [
        { kind: "PLATFORM" as const, role: Role.SUPER_ADMIN, companyId: null, label: "Plataforma ChegowIA" },
        ...companies.map((company: any) => ({
          kind: "COMPANY" as const,
          companyId: company.id,
          label: company.name,
          slug: company.slug,
          roles: AuthService.COMPANY_ROLES,
        })),
        { kind: "STANDALONE" as const, role: Role.CLIENTE, companyId: null, label: "Cliente" },
      ],
    };
  }

  /**
   * Emite uma sessão no contexto escolhido. A elegibilidade é reconferida aqui
   * contra o banco e o ambiente — nunca contra o que veio do navegador.
   */
  async switchContext(identity: JwtPayload, companyId: string | null, role?: Role) {
    const user = await this.multiContextActor(identity);

    // Sem empresa e sem papel: voltar à plataforma.
    if (!companyId && (!role || role === Role.SUPER_ADMIN)) {
      await this.closeSuperAdminSupportAccess(identity.assumedAccessId, user.id, identity.assumedAccessKind);
      const tokens = await this.issueTokens(user);
      this.logger.warn(`Contexto de plataforma retomado por ${user.email}.`);
      return { ...tokens, user: await this.publicUser(user), assumed: null };
    }

    // Papéis que existem fora de empresa. Aceitá-los com companyId seria
    // incoerente: nenhuma rota deles usa tenant.
    if (!companyId) {
      if (role === Role.REVENDEDOR) {
        throw new BadRequestException("Abra a visão de um revendedor específico pela central de parceiros.");
      }
      if (role !== Role.CLIENTE) {
        throw new BadRequestException("Escolha uma empresa para este tipo de acesso.");
      }
      await this.closeSuperAdminSupportAccess(identity.assumedAccessId, user.id, identity.assumedAccessKind);
      const assumed: AssumedContext = { role, companyId: null };
      const tokens = await this.issueTokens(user, assumed);
      this.logger.warn(`Contexto assumido: ${user.email} entrou como ${role}.`);
      return {
        ...tokens,
        user: await this.publicSessionUser(user, assumed),
        assumed: this.assumedMetadata(assumed),
      };
    }

    const chosenRole = role ?? Role.ADMIN;
    if (!AuthService.COMPANY_ROLES.includes(chosenRole)) {
      throw new BadRequestException("Este papel não pode ser assumido dentro de uma empresa.");
    }

    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, isActive: true },
    });
    if (!company || !company.isActive) {
      throw new NotFoundException("Empresa não encontrada ou inativa.");
    }

    await this.closeSuperAdminSupportAccess(identity.assumedAccessId, user.id, identity.assumedAccessKind);
    const assumed: AssumedContext = { role: chosenRole, companyId: company.id, companyName: company.name };
    const tokens = await this.issueTokens(user, assumed);
    // Assumir uma empresa é ação sensível: fica no log com quem, onde e quando.
    this.logger.warn(
      `Contexto assumido: ${user.email} entrou como ${chosenRole} da empresa ${company.name} (${company.id}).`,
    );
    return {
      ...tokens,
      user: await this.publicSessionUser(user, assumed),
      assumed: this.assumedMetadata(assumed),
    };
  }

  /**
   * Gera um atalho de suporte de uso único. Ele é exclusivo do superadmin que
   * o gerou, dura pouco e o token cru nunca vai ao banco nem ao caminho HTTP:
   * fica somente depois de `#` na URL do navegador.
   */
  async createCompanyAdminAccessLink(identity: JwtPayload, companyId: string) {
    // A criação só é válida a partir da visão original da plataforma. Isso
    // impede uma sessão já assumida de encadear novos atalhos de suporte.
    if (identity.assumed || identity.role !== Role.SUPER_ADMIN || identity.companyId) {
      throw new ForbiddenException("Volte à plataforma para gerar um atalho de suporte.");
    }
    const user = await this.multiContextActor(identity);
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, isActive: true },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada.");

    const now = new Date();
    // Um único atalho pendente por superadmin/empresa evita que um link antigo
    // esquecido em histórico ou área de transferência continue aproveitável.
    await this.db().superAdminCompanyAccess.updateMany({
      where: {
        companyId: company.id,
        superAdminId: user.id,
        consumedAt: null,
        revokedAt: null,
        linkExpiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    const token = randomBytes(32).toString("base64url");
    const linkExpiresAt = new Date(now.getTime() + SUPER_ADMIN_ACCESS_LINK_TTL_MS);
    await this.db().superAdminCompanyAccess.create({
      data: {
        companyId: company.id,
        superAdminId: user.id,
        tokenHash: this.hashUrlToken(token),
        linkExpiresAt,
      },
    });

    this.logger.warn(
      `Atalho de suporte gerado por ${user.email} para a empresa ${company.name} (${company.id}).`,
    );
    return {
      company: { id: company.id, name: company.name, isActive: company.isActive },
      accessUrl: `${this.appUrl()}/acesso/suporte#${token}`,
      expiresAt: linkExpiresAt,
    };
  }

  /**
   * Troca para a visão ADMIN sem perder a identidade do superadmin. O claim
   * `sub` continua apontando para a conta de plataforma e o accessId liga cada
   * ação à auditoria persistida do atalho consumido.
   */
  async consumeCompanyAdminAccessLink(identity: JwtPayload, token: string) {
    const user = await this.multiContextActor(identity);
    const now = new Date();
    const access = await this.db().superAdminCompanyAccess.findUnique({
      where: { tokenHash: this.hashUrlToken(token) },
      include: { company: { select: { id: true, name: true, isActive: true } } },
    });
    if (
      !access
      || access.superAdminId !== user.id
      || access.consumedAt
      || access.revokedAt
      || access.linkExpiresAt <= now
      || !access.company
    ) {
      throw new ForbiddenException("Este atalho de suporte não é válido ou expirou.");
    }

    const sessionExpiresAt = new Date(now.getTime() + SUPER_ADMIN_ASSUMED_SESSION_TTL_MS);
    // Claim condicional: duas abas, refresh duplo ou replay do link jamais
    // conseguem abrir duas sessões para o mesmo segredo.
    const claimed = await this.db().superAdminCompanyAccess.updateMany({
      where: {
        id: access.id,
        superAdminId: user.id,
        consumedAt: null,
        revokedAt: null,
        linkExpiresAt: { gt: now },
      },
      data: { consumedAt: now, sessionExpiresAt },
    });
    if (claimed.count !== 1) {
      throw new ForbiddenException("Este atalho de suporte não é válido ou expirou.");
    }

    await this.closeSuperAdminSupportAccess(identity.assumedAccessId, user.id, identity.assumedAccessKind);
    const assumed: AssumedContext = {
      role: Role.ADMIN,
      companyId: access.company.id,
      companyName: access.company.name,
      accessId: access.id,
      accessKind: "COMPANY",
      expiresAt: sessionExpiresAt,
    };
    const tokens = await this.issueTokens(user, assumed);
    this.logger.warn(
      `Acesso de suporte iniciado: ${user.email} entrou como ADMIN da empresa ${access.company.name} (${access.company.id}).`,
    );
    return {
      ...tokens,
      user: await this.publicSessionUser(user, assumed),
      assumed: this.assumedMetadata(assumed),
    };
  }

  /**
   * Gera o atalho temporário para abrir a central de um parceiro específico.
   * O acesso do superadmin é de suporte e somente leitura; nunca vira uma
   * credencial permanente do revendedor nem permite agir financeiramente por ele.
   */
  async createResellerAccessLink(identity: JwtPayload, resellerId: string) {
    if (identity.assumed || identity.role !== Role.SUPER_ADMIN || identity.companyId) {
      throw new ForbiddenException("Volte à plataforma para gerar um atalho de suporte.");
    }
    const user = await this.multiContextActor(identity);
    const reseller = await this.db().resellerProfile.findUnique({
      where: { id: resellerId },
      select: {
        id: true,
        code: true,
        isActive: true,
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
    });
    if (!reseller?.user) throw new NotFoundException("Revendedor não encontrado.");

    const now = new Date();
    await this.db().superAdminResellerAccess.updateMany({
      where: {
        resellerId: reseller.id,
        superAdminId: user.id,
        consumedAt: null,
        revokedAt: null,
        linkExpiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    const token = randomBytes(32).toString("base64url");
    const linkExpiresAt = new Date(now.getTime() + SUPER_ADMIN_ACCESS_LINK_TTL_MS);
    await this.db().superAdminResellerAccess.create({
      data: {
        resellerId: reseller.id,
        superAdminId: user.id,
        tokenHash: this.hashUrlToken(token),
        linkExpiresAt,
      },
    });

    this.logger.warn(
      `Atalho de suporte gerado por ${user.email} para o revendedor ${reseller.user.name} (${reseller.id}).`,
    );
    return {
      reseller: {
        id: reseller.id,
        code: reseller.code,
        name: reseller.user.name,
        email: reseller.user.email,
        isActive: reseller.isActive && reseller.user.isActive,
      },
      accessUrl: `${this.appUrl()}/acesso/suporte/revendedor#${token}`,
      expiresAt: linkExpiresAt,
    };
  }

  /** Consome uma vez o atalho e assume a carteira concreta do revendedor. */
  async consumeResellerAccessLink(identity: JwtPayload, token: string) {
    const user = await this.multiContextActor(identity);
    const now = new Date();
    const access = await this.db().superAdminResellerAccess.findUnique({
      where: { tokenHash: this.hashUrlToken(token) },
      include: {
        reseller: {
          select: {
            id: true,
            code: true,
            isActive: true,
            user: { select: { id: true, name: true, email: true, isActive: true } },
          },
        },
      },
    });
    if (
      !access
      || access.superAdminId !== user.id
      || access.consumedAt
      || access.revokedAt
      || access.linkExpiresAt <= now
      || !access.reseller?.user
    ) {
      throw new ForbiddenException("Este atalho de suporte não é válido ou expirou.");
    }

    const sessionExpiresAt = new Date(now.getTime() + SUPER_ADMIN_ASSUMED_SESSION_TTL_MS);
    const claimed = await this.db().superAdminResellerAccess.updateMany({
      where: {
        id: access.id,
        superAdminId: user.id,
        consumedAt: null,
        revokedAt: null,
        linkExpiresAt: { gt: now },
      },
      data: { consumedAt: now, sessionExpiresAt },
    });
    if (claimed.count !== 1) {
      throw new ForbiddenException("Este atalho de suporte não é válido ou expirou.");
    }

    await this.closeSuperAdminSupportAccess(identity.assumedAccessId, user.id, identity.assumedAccessKind);
    const assumed: AssumedContext = {
      role: Role.REVENDEDOR,
      companyId: null,
      accessId: access.id,
      accessKind: "RESELLER",
      subjectUserId: access.reseller.user.id,
      resellerId: access.reseller.id,
      resellerName: access.reseller.user.name,
      expiresAt: sessionExpiresAt,
    };
    const tokens = await this.issueTokens(user, assumed);
    this.logger.warn(
      `Acesso de suporte iniciado: ${user.email} abriu a visão do revendedor ${access.reseller.user.name} (${access.reseller.id}).`,
    );
    return {
      ...tokens,
      user: await this.publicSessionUser(user, assumed),
      assumed: this.assumedMetadata(assumed),
    };
  }

  private async multiContextActor(identity: JwtPayload) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || !user.isActive || !this.isMultiContextUser(user)) {
      throw new ForbiddenException("Esta conta não pode trocar de contexto.");
    }
    return user;
  }

  private async closeSuperAdminSupportAccess(
    accessId: string | undefined,
    superAdminId: string,
    accessKind?: SuperAdminSupportAccessKind,
  ) {
    if (!accessId) return;
    // Tokens emitidos antes do suporte de revendedor não possuem tipo; como só
    // existia acesso de empresa, compatibilidade segura é tratá-los como COMPANY.
    const repository = accessKind === "RESELLER"
      ? this.db().superAdminResellerAccess
      : this.db().superAdminCompanyAccess;
    if (!repository?.updateMany) return;
    await repository.updateMany({
      where: {
        id: accessId,
        superAdminId,
        consumedAt: { not: null },
        closedAt: null,
      },
      data: { closedAt: new Date() },
    }).catch(() => undefined);
  }

  private assumedMetadata(assumed: AssumedContext) {
    return {
      companyId: assumed.companyId,
      companyName: assumed.companyName ?? null,
      resellerId: assumed.resellerId ?? null,
      resellerName: assumed.resellerName ?? null,
      role: assumed.role,
      supportAccess: Boolean(assumed.accessId),
      kind: assumed.accessId ? assumed.accessKind ?? "COMPANY" : null,
    };
  }

  async registerCustomer(dto: RegisterCustomerDto) {
    const email = dto.email.trim().toLowerCase();
    if (isReservedDemoEmail(email)) {
      throw new BadRequestException("Este e-mail é reservado à operação interna de demonstração.");
    }
    const existing = await this.db().user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    const acceptedAt = new Date();
    const user = await this.db().user.create({
      data: {
        name: dto.name.trim(),
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        role: Role.CLIENTE,
        termsAcceptedAt: acceptedAt,
        privacyAcceptedAt: acceptedAt,
        addresses: {
          create: {
            label: "Casa",
            street: dto.street,
            number: dto.number,
            neighborhood: dto.neighborhood,
            city: dto.city,
            state: dto.state.toUpperCase(),
            zipCode: dto.zipCode,
            complement: dto.complement,
            isDefault: true,
          },
        },
      },
    });
    const delivered = await this.sendVerificationForUser(user.id);
    return {
      verificationRequired: true,
      email: user.email,
      message: delivered
        ? "Conta criada. Enviamos um link de confirmação para o seu e-mail."
        : "Conta criada. O envio do e-mail ficou pendente; use “reenviar confirmação” em alguns instantes.",
    };
  }

  async verifyEmail(token: string) {
    const record = await this.findUrlToken(token, AccountTokenType.VERIFICACAO_EMAIL);
    const user = await this.db().$transaction(async (tx: any) => {
      await tx.accountToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      return tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
    });
    const tokens = await this.issueTokens(user);
    return { ...tokens, user: await this.publicUser(user) };
  }

  async resendVerification(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db().user.findUnique({ where: { email } });
    if (user?.isActive && !user.emailVerifiedAt) {
      await this.sendVerificationForUser(user.id);
    }
    return {
      success: true,
      message: "Se existir uma conta pendente para este e-mail, um novo link será enviado.",
    };
  }

  async sendVerificationForUser(userId: string) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user?.isActive || user.emailVerifiedAt) return true;
    const token = await this.createUrlToken(
      user.id,
      AccountTokenType.VERIFICACAO_EMAIL,
      EMAIL_VERIFICATION_TTL_MS,
    );
    try {
      await this.mail.sendVerification(user.email, user.name, token);
      return true;
    } catch (error) {
      this.logger.error(
        `Falha ao enviar confirmação para o usuário ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  async forgotPassword(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.db().user.findUnique({ where: { email } });
    if (user?.isActive) {
      const token = await this.createUrlToken(
        user.id,
        AccountTokenType.REDEFINICAO_SENHA,
        PASSWORD_RESET_TTL_MS,
      );
      await this.mail.sendPasswordReset(user.email, user.name, token).catch((error) => {
        this.logger.error(
          `Falha ao enviar redefinição para o usuário ${user.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    }
    return {
      success: true,
      message: "Se este e-mail estiver cadastrado, você receberá as instruções em instantes.",
    };
  }

  /**
   * Troca de senha para quem já está logado. Não pedimos a senha atual: quem
   * conclui a troca é quem abre o e-mail da conta, e é essa posse que autoriza.
   * Uma sessão roubada consegue disparar o e-mail, mas não consegue terminar a
   * troca sem acesso à caixa de entrada — e o próprio aviso denuncia o ataque.
   *
   * Reaproveita o token de redefinição já existente, então o link cai na mesma
   * tela testada de /redefinir-senha.
   */
  async requestPasswordChange(userId: string) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Sua sessão não é mais válida.");
    }

    // Invalida pedidos anteriores ainda abertos: dois links válidos ao mesmo
    // tempo ampliam a janela de uso indevido sem ajudar em nada.
    await this.db().accountToken.updateMany({
      where: { userId: user.id, type: AccountTokenType.REDEFINICAO_SENHA, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = await this.createUrlToken(
      user.id,
      AccountTokenType.REDEFINICAO_SENHA,
      PASSWORD_RESET_TTL_MS,
    );
    await this.mail.sendPasswordReset(user.email, user.name, token).catch((error) => {
      this.logger.error(
        `Falha ao enviar troca de senha para o usuário ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    });

    return {
      success: true,
      // O e-mail vai mascarado para não confirmar o endereço a quem estiver
      // usando uma sessão que não é sua.
      emailHint: this.maskEmail(user.email),
      message: "Enviamos um link para o seu e-mail. Ele vale por 30 minutos.",
    };
  }

  async resetPassword(token: string, password: string) {
    const record = await this.findUrlToken(token, AccountTokenType.REDEFINICAO_SENHA);
    await this.db().$transaction([
      this.db().user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await bcrypt.hash(password, 12),
          emailVerifiedAt: new Date(),
        },
      }),
      this.db().accountToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.db().refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    // Redefinir senha é o caminho de "perdi o controle da conta": derrubar os
    // sockets corta o stream ao vivo de quem estiver conectado com a
    // credencial antiga.
    this.realtime.disconnectUser(record.userId, "senha redefinida");
    return { success: true };
  }

  async verifyMfa(challengeId: string, code: string) {
    const record = await this.db().accountToken.findFirst({
      where: {
        id: challengeId,
        type: AccountTokenType.LOGIN_MFA,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!record || !record.user.isActive || !(await bcrypt.compare(code, record.tokenHash))) {
      throw new UnauthorizedException("Código inválido ou expirado.");
    }
    await this.db().accountToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    const tokens = await this.issueTokens(record.user);
    return {
      ...tokens,
      user: await this.publicUser(record.user),
      multiContext: this.isMultiContextUser(record.user),
    };
  }

  async refresh(cookieValue: string | undefined) {
    if (!cookieValue || !cookieValue.includes(".")) {
      throw new UnauthorizedException("Sessão inválida.");
    }
    const [tokenId, secret] = cookieValue.split(".");
    const record = await this.db().refreshToken.findUnique({ where: { id: tokenId } });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException("Sessão expirada, faça login novamente.");
    }
    const secretOk = await bcrypt.compare(secret, record.tokenHash);
    if (!secretOk) throw new UnauthorizedException("Sessão inválida.");

    const revoked = await this.db().refreshToken.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new UnauthorizedException("Sessão já utilizada. Faça login novamente.");
    }

    const user = await this.db().user.findUnique({ where: { id: record.userId } });
    if (!user || !user.isActive || !user.emailVerifiedAt) throw new UnauthorizedException("Usuário inativo.");

    /**
     * Renovar mantém o contexto assumido — sem isto o superadmin cairia de volta
     * para a plataforma no meio do trabalho dentro de uma empresa. A elegibilidade
     * é reconferida: se a conta perdeu o direito, a sessão volta ao papel real em
     * vez de continuar assumindo.
     */
    let assumed: AssumedContext | null = null;
    if (record.assumedRole && this.isMultiContextUser(user)) {
      if (record.assumedAccessId) {
        // Uma sessão aberta por atalho não pode ser renovada para além da sua
        // janela. Também é aqui que logout/retorno à plataforma derruba abas
        // antigas que ainda tenham um refresh cookie válido.
        // O banco pode conter registros emitidos antes da coluna existir. Só
        // reconhecemos explicitamente RESELLER; qualquer outro valor legado
        // continua no caminho mais restrito e já existente de COMPANY.
        const accessKind: SuperAdminSupportAccessKind = record.assumedAccessKind === "RESELLER"
          ? "RESELLER"
          : "COMPANY";
        if (accessKind === "COMPANY" && record.assumedRole === Role.ADMIN) {
          const access = await this.db().superAdminCompanyAccess?.findFirst?.({
            where: {
              id: record.assumedAccessId,
              superAdminId: user.id,
              consumedAt: { not: null },
              revokedAt: null,
              closedAt: null,
              sessionExpiresAt: { gt: new Date() },
            },
            include: { company: { select: { id: true, name: true } } },
          });
          if (access?.company && access.sessionExpiresAt) {
            assumed = {
              role: Role.ADMIN,
              companyId: record.assumedCompanyId ?? access.company.id,
              companyName: access.company.name,
              accessId: access.id,
              accessKind: "COMPANY",
              expiresAt: access.sessionExpiresAt,
            };
          }
        } else if (
          accessKind === "RESELLER"
          && record.assumedRole === Role.REVENDEDOR
          && !record.assumedCompanyId
          && record.assumedUserId
          && record.assumedResellerId
        ) {
          const access = await this.db().superAdminResellerAccess?.findFirst?.({
            where: {
              id: record.assumedAccessId,
              resellerId: record.assumedResellerId,
              superAdminId: user.id,
              consumedAt: { not: null },
              revokedAt: null,
              closedAt: null,
              sessionExpiresAt: { gt: new Date() },
              reseller: { userId: record.assumedUserId },
            },
            include: { reseller: { select: { id: true, userId: true, user: { select: { name: true } } } } },
          });
          if (access?.reseller?.user && access.sessionExpiresAt) {
            assumed = {
              role: Role.REVENDEDOR,
              companyId: null,
              accessId: access.id,
              accessKind: "RESELLER",
              subjectUserId: access.reseller.userId,
              resellerId: access.reseller.id,
              resellerName: access.reseller.user.name,
              expiresAt: access.sessionExpiresAt,
            };
          }
        }
        if (!assumed) {
          await this.closeSuperAdminSupportAccess(record.assumedAccessId, user.id, accessKind);
        }
      } else if (record.assumedRole !== Role.REVENDEDOR) {
        assumed = { role: record.assumedRole, companyId: record.assumedCompanyId ?? null };
      }
    }

    const tokens = await this.issueTokens(user, assumed);
    return {
      ...tokens,
      user: await this.publicSessionUser(user, assumed),
    };
  }

  async logout(cookieValue: string | undefined) {
    if (!cookieValue || !cookieValue.includes(".")) return;
    const [tokenId] = cookieValue.split(".");
    const record = await this.db().refreshToken
      .findUnique({
        where: { id: tokenId },
        select: { userId: true, assumedAccessId: true, assumedAccessKind: true },
      })
      .catch(() => null);
    await this.db().refreshToken
      .update({ where: { id: tokenId }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
    if (record?.assumedAccessId) {
      await this.closeSuperAdminSupportAccess(record.assumedAccessId, record.userId, record.assumedAccessKind);
    }
  }

  async me(identity: JwtPayload) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const assumed: AssumedContext | null = identity.assumed
      ? {
        role: identity.role,
        companyId: identity.companyId,
        accessId: identity.assumedAccessId ?? null,
        accessKind: identity.assumedAccessKind ?? null,
        subjectUserId: identity.assumedUserId ?? null,
        resellerId: identity.assumedResellerId ?? null,
      }
      : null;
    return this.publicSessionUser(user, assumed);
  }

  private async createUrlToken(userId: string, type: AccountTokenType, ttlMs: number) {
    await this.db().accountToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = randomBytes(32).toString("base64url");
    await this.db().accountToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hashUrlToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return token;
  }

  private async findUrlToken(token: string, type: AccountTokenType) {
    const record = await this.db().accountToken.findFirst({
      where: {
        tokenHash: this.hashUrlToken(token),
        type,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!record) throw new BadRequestException("Link inválido ou expirado.");
    return record;
  }

  private hashUrlToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private requiresMfa(role: Role) {
    const configured = process.env.MFA_REQUIRED_ROLES
      ?? (process.env.NODE_ENV === "production" ? "SUPER_ADMIN,ADMIN,REVENDEDOR" : "");
    return configured
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .includes(role);
  }

  private maskEmail(email: string) {
    const [name, domain] = email.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }

  /** URL pública do web app; nunca use a URL da API para levar o navegador. */
  private appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  /**
   * A resposta de sessão mostra o papel assumido para o painel, mas preserva
   * explicitamente quem é o ator real. O front usa isso apenas para informar a
   * pessoa; a API continua confiando exclusivamente nos claims e no banco.
   */
  private async publicSessionUser(user: any, assumed?: AssumedContext | null) {
    const publicUser = await this.publicUser(user);
    if (!assumed) return publicUser;

    let companyName = assumed.companyName ?? null;
    if (assumed.companyId && !companyName) {
      const company = await this.db().company.findUnique({
        where: { id: assumed.companyId },
        select: { name: true },
      }).catch(() => null);
      companyName = company?.name ?? null;
    }

    let resellerName = assumed.resellerName ?? null;
    if (assumed.resellerId && !resellerName) {
      const reseller = await this.db().resellerProfile.findUnique({
        where: { id: assumed.resellerId },
        select: { user: { select: { name: true } } },
      }).catch(() => null);
      resellerName = reseller?.user?.name ?? null;
    }

    return {
      ...publicUser,
      role: assumed.role,
      companyId: assumed.companyId,
      actorRole: user.role,
      impersonation: this.assumedMetadata({ ...assumed, companyName, resellerName }),
    };
  }

  private async publicUser(user: any) {
    const permissionKeys = await this.permissionKeysFor(user);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      avatarUrl: user.avatarUrl,
      emailVerified: Boolean(user.emailVerifiedAt),
      permissionKeys,
    };
  }

  /**
   * O painel usa esta lista somente para mostrar ou desabilitar seções. A API
   * continua validando cada ação no PermissionsGuard, portanto a interface não
   * se torna uma fonte de autorização.
   */
  private async permissionKeysFor(user: { id: string; role: Role }) {
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return Object.values(PermissionKey);
    }
    if (!EMPLOYEE_ROLES.includes(user.role)) {
      return [];
    }

    const profile = await this.db().employeeProfile.findUnique({
      where: { userId: user.id },
      select: { rolePermissions: { select: { permission: { select: { key: true } } } } },
    });
    return (profile?.rolePermissions ?? []).map((rolePermission: any) => rolePermission.permission.key);
  }
}
