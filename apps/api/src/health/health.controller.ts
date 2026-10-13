import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { SkipThrottle } from "@nestjs/throttler";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { MetricsService } from "../common/observability/metrics.service";
import { appRole } from "../common/config/app-role";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly metrics: MetricsService,
  ) {}

  @Public()
  @Get("live")
  @SkipThrottle()
  live() {
    return { status: "ok", role: appRole(), ...(process.env.RENDER_GIT_COMMIT
      ? { revision: process.env.RENDER_GIT_COMMIT.slice(0, 12) }
      : {}) };
  }

  @Public()
  @Get("ready")
  @SkipThrottle()
  async ready() {
    try {
      await (this.prisma as any).$queryRaw`SELECT 1`;
      return { status: "ready", role: appRole(), ...(process.env.RENDER_GIT_COMMIT
        ? { revision: process.env.RENDER_GIT_COMMIT.slice(0, 12) }
        : {}) };
    } catch {
      throw new ServiceUnavailableException("Serviço temporariamente indisponível.");
    }
  }

  /**
   * Métricas no formato Prometheus.
   *
   * Pública por necessidade — o coletor não faz login —, mas protegida por um
   * token compartilhado. Sem ele a rota expõe volume de pedidos, latência e
   * uso de memória para qualquer um que descubra a URL, o que é informação
   * comercial da operação de cada lojista, ainda que agregada.
   */
  @Public()
  @Get("metrics")
  @SkipThrottle()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async metricsEndpoint(@Query("token") token?: string) {
    const esperado = process.env.METRICS_TOKEN?.trim();
    if (!esperado) {
      throw new ForbiddenException("A coleta de métricas não está habilitada neste ambiente.");
    }
    if (token !== esperado) throw new ForbiddenException("Token de métricas inválido.");

    await this.collectQueueDepths();
    return this.metrics.render();
  }

  /**
   * Profundidade das filas.
   *
   * São os números que já indicaram problema neste sistema: evento Stripe
   * preso, repasse não confirmado, nota fiscal em contingência. Medidos na
   * hora da raspagem em vez de continuamente porque o coletor decide a
   * frequência, não a aplicação.
   */
  private async collectQueueDepths() {
    const db = this.prisma as any;
    const [eventosPresos, repassesPendentes, notasPendentes, certificadosVencendo] = await Promise.all([
      db.stripeEvent.count({ where: { status: { in: ["PENDENTE", "FALHOU"] } } }).catch(() => -1),
      db.payoutBatch.count({ where: { status: "PROCESSANDO" } }).catch(() => -1),
      db.fiscalDocument.count({ where: { status: { in: ["CONTINGENCIA", "ASSINADA"] } } }).catch(() => -1),
      db.fiscalCertificate.count({
        where: {
          status: "ATIVO",
          notAfter: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        },
      }).catch(() => -1),
    ]);

    this.metrics.setGauge("chegowia_stripe_events_pending", eventosPresos);
    this.metrics.setGauge("chegowia_payouts_processing", repassesPendentes);
    this.metrics.setGauge("chegowia_fiscal_documents_pending", notasPendentes);
    this.metrics.setGauge("chegowia_fiscal_certificates_expiring", certificadosVencendo);
  }
}
