import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { MetricsService } from "./metrics.service";

/**
 * Conta e cronometra cada requisição HTTP.
 *
 * O caminho é o **template da rota** (`/api/orders/:id`), não a URL concreta.
 * Usar a URL faria a cardinalidade explodir — uma série temporal por id de
 * pedido derruba qualquer Prometheus em uma semana.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const inicio = process.hrtime.bigint();

    const registrar = () => {
      const segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      const rota = request.route?.path ?? "desconhecida";
      const labels = {
        method: request.method,
        route: rota,
        status: String(response.statusCode ?? 0),
      };
      this.metrics.increment("chegowia_http_requests_total", labels);
      this.metrics.observe("chegowia_http_request_duration_seconds", segundos, {
        method: labels.method,
        route: labels.route,
      });
    };

    return next.handle().pipe(tap({ next: registrar, error: registrar }));
  }
}
