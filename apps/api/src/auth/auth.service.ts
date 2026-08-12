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
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { MailService } from "../common/mail/mail.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import { RealtimeGateway } from "../realtime/realtime.gateway";

interface IssuedTokens {
  accessToken: string;
  refreshTokenCookie: string;
  refreshTokenExpiresAt: Date;
}

/** Papel e empresa que o superadmin multiacesso decidiu assumir nesta sessão. */
interface AssumedContext {
  role: Role;
  companyId: string | null;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MFA_TTL_MS = 10 * 60 * 1000;
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
      return { sub: user.id, email: user.email, role: assumed.role, companyId: assumed.companyId, assumed: true };
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
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const record = await this.db().refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        assumedRole: assumed?.role ?? null,
        assumedCompanyId: assumed?.companyId ?? null,
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
   * cada empresa ativa, e os papéis que existem fora de empresa (revendedor e
   * cliente). É o que permite ver o sistema exatamente como cada pessoa vê, sem
   * manter uma conta de teste por papel.
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
        { kind: "STANDALONE" as const, role: Role.REVENDEDOR, companyId: null, label: "Revendedor" },
        { kind: "STANDALONE" as const, role: Role.CLIENTE, companyId: null, label: "Cliente" },
      ],
    };
  }

  /**
   * Emite uma sessão no contexto escolhido. A elegibilidade é reconferida aqui
   * contra o banco e o ambiente — nunca contra o que veio do navegador.
   */
  async switchContext(identity: JwtPayload, companyId: string | null, role?: Role) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || !user.isActive || !this.isMultiContextUser(user)) {
      throw new ForbiddenException("Esta conta não pode trocar de contexto.");
    }

    // Sem empresa e sem papel: voltar à plataforma.
    if (!companyId && (!role || role === Role.SUPER_ADMIN)) {
      const tokens = await this.issueTokens(user);
      this.logger.warn(`Contexto de plataforma retomado por ${user.email}.`);
      return { ...tokens, user: await this.publicUser(user), assumed: null };
    }

    // Papéis que existem fora de empresa. Aceitá-los com companyId seria
    // incoerente: nenhuma rota deles usa tenant.
    if (!companyId) {
      if (role !== Role.REVENDEDOR && role !== Role.CLIENTE) {
        throw new BadRequestException("Escolha uma empresa para este tipo de acesso.");
      }
      const assumed: AssumedContext = { role, companyId: null };
      const tokens = await this.issueTokens(user, assumed);
      this.logger.warn(`Contexto assumido: ${user.email} entrou como ${role}.`);
      return {
        ...tokens,
        user: { ...(await this.publicUser(user)), role, companyId: null },
        assumed: { companyId: null, companyName: null, role },
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

    const assumed: AssumedContext = { role: chosenRole, companyId: company.id };
    const tokens = await this.issueTokens(user, assumed);
    // Assumir uma empresa é ação sensível: fica no log com quem, onde e quando.
    this.logger.warn(
      `Contexto assumido: ${user.email} entrou como ${chosenRole} da empresa ${company.name} (${company.id}).`,
    );
    return {
      ...tokens,
      user: { ...(await this.publicUser(user)), role: chosenRole, companyId: company.id },
      assumed: { companyId: company.id, companyName: company.name, role: chosenRole },
    };
  }

  async registerCustomer(dto: RegisterCustomerDto) {
    const email = dto.email.trim().toLowerCase();
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
    const assumed: AssumedContext | null = record.assumedRole && this.isMultiContextUser(user)
      ? { role: record.assumedRole, companyId: record.assumedCompanyId ?? null }
      : null;

    const tokens = await this.issueTokens(user, assumed);
    const publicUser = await this.publicUser(user);
    return {
      ...tokens,
      user: assumed ? { ...publicUser, role: assumed.role, companyId: assumed.companyId } : publicUser,
    };
  }

  async logout(cookieValue: string | undefined) {
    if (!cookieValue || !cookieValue.includes(".")) return;
    const [tokenId] = cookieValue.split(".");
    await this.db().refreshToken
      .update({ where: { id: tokenId }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async me(userId: string) {
    const user = await this.db().user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return this.publicUser(user);
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
