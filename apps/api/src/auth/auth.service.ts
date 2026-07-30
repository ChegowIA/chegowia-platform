import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { LoginDto } from "./dto/login.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";

interface IssuedTokens {
  accessToken: string;
  refreshTokenCookie: string;
  refreshTokenExpiresAt: Date;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  private toPayload(user: { id: string; email: string; role: Role; companyId: string | null }): JwtPayload {
    return { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
  }

  private async issueTokens(user: { id: string; email: string; role: Role; companyId: string | null }): Promise<IssuedTokens> {
    const accessToken = this.jwtService.sign(this.toPayload(user), {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    });

    const secret = randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(secret, 10);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const record = await (this.prisma as any).refreshToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return {
      accessToken,
      refreshTokenCookie: `${record.id}.${secret}`,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  async validateUser(email: string, password: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw new UnauthorizedException("Credenciais inválidas.");
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException("Credenciais inválidas.");
    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    const tokens = await this.issueTokens(user);
    return {
      ...tokens,
      user: this.publicUser(user),
    };
  }

  async registerCustomer(dto: RegisterCustomerDto) {
    const existing = await (this.prisma as any).user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    const user = await (this.prisma as any).user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: Role.CLIENTE,
      },
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: this.publicUser(user) };
  }

  async refresh(cookieValue: string | undefined) {
    if (!cookieValue || !cookieValue.includes(".")) {
      throw new UnauthorizedException("Sessão inválida.");
    }
    const [tokenId, secret] = cookieValue.split(".");
    const record = await (this.prisma as any).refreshToken.findUnique({ where: { id: tokenId } });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException("Sessão expirada, faça login novamente.");
    }
    const secretOk = await bcrypt.compare(secret, record.tokenHash);
    if (!secretOk) throw new UnauthorizedException("Sessão inválida.");

    await (this.prisma as any).refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const user = await (this.prisma as any).user.findUnique({ where: { id: record.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException("Usuário inativo.");

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: this.publicUser(user) };
  }

  async logout(cookieValue: string | undefined) {
    if (!cookieValue || !cookieValue.includes(".")) return;
    const [tokenId] = cookieValue.split(".");
    await (this.prisma as any).refreshToken
      .update({ where: { id: tokenId }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async me(userId: string) {
    const user = await (this.prisma as any).user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.publicUser(user);
  }

  private publicUser(user: any) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      avatarUrl: user.avatarUrl,
    };
  }
}
