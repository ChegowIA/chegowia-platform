import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedRequest, JwtPayload } from "../interfaces/jwt-payload.interface";

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return data ? request.user?.[data] : request.user;
  },
);
