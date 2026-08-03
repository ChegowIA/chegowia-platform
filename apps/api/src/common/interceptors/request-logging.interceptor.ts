import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, tap } from "rxjs";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const requestId = String(request.headers["x-request-id"] ?? randomUUID()).slice(0, 128);
    const startedAt = Date.now();

    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    return next.handle().pipe(
      tap({
        finalize: () => {
          this.logger.log(JSON.stringify({
            requestId,
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
            userId: request.user?.sub,
            companyId: request.user?.companyId,
          }));
        },
      }),
    );
  }
}
