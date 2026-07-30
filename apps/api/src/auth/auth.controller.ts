import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterCustomerDto } from "./dto/register-customer.dto";

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
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshTokenCookie, refreshTokenExpiresAt, user } = await this.authService.login(dto);
    this.setRefreshCookie(res, refreshTokenCookie, refreshTokenExpiresAt);
    return { accessToken, user };
  }

  @Public()
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterCustomerDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshTokenCookie, refreshTokenExpiresAt, user } =
      await this.authService.registerCustomer(dto);
    this.setRefreshCookie(res, refreshTokenCookie, refreshTokenExpiresAt);
    return { accessToken, user };
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE];
    const { accessToken, refreshTokenCookie, refreshTokenExpiresAt, user } =
      await this.authService.refresh(cookieValue);
    this.setRefreshCookie(res, refreshTokenCookie, refreshTokenExpiresAt);
    return { accessToken, user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE];
    await this.authService.logout(cookieValue);
    res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
    return { success: true };
  }

  @Get("me")
  async me(@CurrentUser("sub") userId: string) {
    return this.authService.me(userId);
  }
}
