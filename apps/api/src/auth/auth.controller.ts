import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AllowInactiveSubscription } from "../common/decorators/allow-inactive-subscription.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";
import { SwitchContextDto } from "./dto/switch-context.dto";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import {
  ForgotPasswordDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyMfaDto,
} from "./dto/auth-actions.dto";

const REFRESH_COOKIE = "refresh_token";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth",
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, cookieValue: string, expiresAt: Date) {
    res.cookie(REFRESH_COOKIE, cookieValue, { ...REFRESH_COOKIE_OPTIONS, expires: expiresAt });
  }

  @Public()
  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if (result.mfaRequired) return result;
    this.setRefreshCookie(res, result.refreshTokenCookie, result.refreshTokenExpiresAt);
    return {
      accessToken: result.accessToken,
      user: result.user,
      mfaRequired: false,
      multiContext: result.multiContext,
    };
  }

  /**
   * Contextos que o superadmin multiacesso pode assumir. Devolve lista vazia para
   * qualquer outra conta, então não serve para descobrir empresas.
   */
  @AllowInactiveSubscription()
  @Get("contexts")
  listContexts(@CurrentUser() user: JwtPayload) {
    return this.authService.availableContexts(user);
  }

  /**
   * Troca o contexto da sessão. Emite um token novo com o papel escolhido; o
   * usuário real continua no `sub` do token, para auditoria.
   */
  // Trocar de contexto é justamente como se sai de uma empresa bloqueada.
  @AllowInactiveSubscription()
  @Post("context")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async switchContext(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchContextDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.switchContext(user, dto.companyId ?? null, dto.role);
    this.setRefreshCookie(res, result.refreshTokenCookie, result.refreshTokenExpiresAt);
    return { accessToken: result.accessToken, user: result.user, assumed: result.assumed };
  }

  @Public()
  @Post("register")
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Public()
  @Post("verify-email")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyEmail(dto.token);
    this.setRefreshCookie(res, result.refreshTokenCookie, result.refreshTokenExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post("resend-verification")
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post("forgot-password")
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post("reset-password")
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post("mfa/verify")
  @Throttle({ default: { limit: 6, ttl: 10 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyMfa(@Body() dto: VerifyMfaDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyMfa(dto.challengeId, dto.code);
    this.setRefreshCookie(res, result.refreshTokenCookie, result.refreshTokenExpiresAt);
    // Em produção o superadmin sempre passa por MFA, então esta é a resposta que
    // decide se o seletor de contexto aparece. Omitir o campo aqui fazia o login
    // multiacesso não existir justamente para quem ele foi feito.
    return { accessToken: result.accessToken, user: result.user, multiContext: result.multiContext };
  }

  @Public()
  @Post("refresh")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE];
    const { accessToken, refreshTokenCookie, refreshTokenExpiresAt, user } =
      await this.authService.refresh(cookieValue);
    this.setRefreshCookie(res, refreshTokenCookie, refreshTokenExpiresAt);
    return { accessToken, user };
  }

  /**
   * Sair precisa funcionar mesmo com a assinatura bloqueada. Sem esta exceção o
   * guard de assinatura recusa a rota e a pessoa fica presa na conta, sem forma
   * de trocar de usuário nem de sair.
   */
  @AllowInactiveSubscription()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE];
    await this.authService.logout(cookieValue);
    res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
    return { success: true };
  }

  /**
   * Troca de senha de quem já está logado. O limite é apertado de propósito: o
   * endpoint dispara e-mail, e sem trava vira ferramenta de flood contra a
   * caixa de entrada do próprio usuário.
   */
  // Trocar a senha é caminho de recuperação de conta: não pode depender de
  // assinatura em dia.
  @AllowInactiveSubscription()
  @Post("change-password")
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser("sub") userId: string) {
    return this.authService.requestPasswordChange(userId);
  }

  /** O painel bloqueado ainda precisa saber quem está logado para se desenhar. */
  @AllowInactiveSubscription()
  @Get("me")
  async me(@CurrentUser("sub") userId: string) {
    return this.authService.me(userId);
  }
}
