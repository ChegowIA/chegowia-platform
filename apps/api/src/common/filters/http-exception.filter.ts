import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const isUniqueConflict = exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2002";
    const status = isHttpException ? exception.getStatus() : isUniqueConflict ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException ? exception.getResponse() : null;

    const rawMessage = isHttpException
      ? typeof body === "string"
        ? body
        : (body as any)?.message ?? exception.message
      : isUniqueConflict
        ? "Já existe uma conta utilizando este e-mail, CPF ou CNPJ."
        : "Erro interno inesperado.";
    const message = localizeHttpMessage(rawMessage, status);

    if (!isHttpException) {
      this.logger.error(`${request.method} ${request.url} — ${(exception as Error)?.stack ?? exception}`);
    }

    response.status(status).json({
      statusCode: status,
      requestId: request.requestId,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}

function localizeHttpMessage(message: unknown, status: number) {
  const normalized = Array.isArray(message) ? message.join(" ") : String(message ?? "").trim();
  const defaults: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: "Os dados informados são inválidos.",
    [HttpStatus.UNAUTHORIZED]: "Sua sessão não é válida. Entre novamente.",
    [HttpStatus.FORBIDDEN]: "Você não tem permissão para realizar esta ação.",
    [HttpStatus.NOT_FOUND]: "O recurso solicitado não foi encontrado.",
    [HttpStatus.CONFLICT]: "Não foi possível concluir porque os dados entram em conflito.",
    [HttpStatus.PAYLOAD_TOO_LARGE]: "O arquivo ou conteúdo enviado excede o tamanho permitido.",
    [HttpStatus.TOO_MANY_REQUESTS]: "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
    [HttpStatus.INTERNAL_SERVER_ERROR]: "Erro interno inesperado.",
    [HttpStatus.SERVICE_UNAVAILABLE]: "Serviço temporariamente indisponível. Tente novamente.",
  };
  const nestDefaults = new Set([
    "Bad Request",
    "Conflict",
    "Forbidden",
    "Internal Server Error",
    "Not Found",
    "Payload Too Large",
    "Service Unavailable",
    "Too Many Requests",
    "Unauthorized",
  ]);
  const looksLikeUntranslatedTechnicalMessage = /\b(bad request|conflict|forbidden|internal server error|not found|payload too large|service unavailable|too many requests|unauthorized|invalid|required|must be|failed|unable to|something went wrong)\b/i.test(normalized);
  return !normalized || nestDefaults.has(normalized) || looksLikeUntranslatedTechnicalMessage
    ? defaults[status] ?? "Não foi possível concluir a solicitação."
    : normalized;
}
