import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { JwtPayload } from "../../common/interfaces/jwt-payload.interface";
import { activeMfaSessionFromPayload } from "../../common/security/mfa-session";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET ?? "dev-secret",
      issuer: process.env.JWT_ISSUER ?? "chegowia-api",
      audience: process.env.JWT_AUDIENCE ?? "chegowia-web",
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // O `exp` curto do JWT continua valendo, mas a janela de 24h é uma regra
    // adicional e absoluta. Tokens legados sem este carimbo também são
    // recusados, obrigando o primeiro login pós-política a passar pelo MFA.
    if (!activeMfaSessionFromPayload(payload)) {
      throw new UnauthorizedException("Sessão expirada. Entre novamente e confirme o código.");
    }
    return payload;
  }
}
