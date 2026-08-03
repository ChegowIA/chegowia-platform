import { Injectable } from "@nestjs/common";

/**
 * Métricas em formato Prometheus.
 *
 * Deliberadamente sem biblioteca: o que precisa ser observado aqui são
 * contadores e histogramas simples, e um cliente completo traria um servidor
 * HTTP próprio, agregadores de cluster e um formato que ninguém revisa. O
 * texto de exposição do Prometheus é estável e cabe em 100 linhas.
 *
 * O que se mede foi escolhido pelo que já deu problema neste sistema: fila de
 * cobrança parada, nota fiscal presa em contingência, requisição lenta. Métrica
 * que ninguém olha é ruído.
 */

interface HistogramState {
  buckets: Map<number, number>;
  sum: number;
  count: number;
}

/** Faixas em segundos. A última cobre "lento demais para o balcão". */
const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();

  increment(name: string, labels: Record<string, string> = {}, value = 1) {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}) {
    this.gauges.set(this.key(name, labels), value);
  }

  observe(name: string, seconds: number, labels: Record<string, string> = {}) {
    const key = this.key(name, labels);
    const estado = this.histograms.get(key) ?? { buckets: new Map(), sum: 0, count: 0 };
    for (const limite of LATENCY_BUCKETS) {
      if (seconds <= limite) estado.buckets.set(limite, (estado.buckets.get(limite) ?? 0) + 1);
    }
    estado.sum += seconds;
    estado.count += 1;
    this.histograms.set(key, estado);
  }

  /** Texto no formato de exposição do Prometheus. */
  render(): string {
    const linhas: string[] = [];

    for (const [key, valor] of this.counters) {
      linhas.push(`${key} ${valor}`);
    }
    for (const [key, valor] of this.gauges) {
      linhas.push(`${key} ${valor}`);
    }
    for (const [key, estado] of this.histograms) {
      const { name, labels } = this.parse(key);
      let acumulado = 0;
      for (const limite of LATENCY_BUCKETS) {
        acumulado = estado.buckets.get(limite) ?? acumulado;
        linhas.push(`${name}_bucket${this.render_labels({ ...labels, le: String(limite) })} ${acumulado}`);
      }
      linhas.push(`${name}_bucket${this.render_labels({ ...labels, le: "+Inf" })} ${estado.count}`);
      linhas.push(`${name}_sum${this.render_labels(labels)} ${estado.sum.toFixed(6)}`);
      linhas.push(`${name}_count${this.render_labels(labels)} ${estado.count}`);
    }

    linhas.push(`chegowia_process_uptime_seconds ${Math.floor(process.uptime())}`);
    const memoria = process.memoryUsage();
    linhas.push(`chegowia_process_heap_used_bytes ${memoria.heapUsed}`);
    linhas.push(`chegowia_process_rss_bytes ${memoria.rss}`);

    return `${linhas.join("\n")}\n`;
  }

  private key(name: string, labels: Record<string, string>) {
    return `${name}${this.render_labels(labels)}`;
  }

  private render_labels(labels: Record<string, string>) {
    const entradas = Object.entries(labels).filter(([, valor]) => valor !== undefined && valor !== "");
    if (!entradas.length) return "";
    const corpo = entradas
      .map(([chave, valor]) => `${chave}="${String(valor).replace(/["\\\n]/g, "_")}"`)
      .join(",");
    return `{${corpo}}`;
  }

  private parse(key: string) {
    const abre = key.indexOf("{");
    if (abre === -1) return { name: key, labels: {} as Record<string, string> };
    const name = key.slice(0, abre);
    const corpo = key.slice(abre + 1, -1);
    const labels: Record<string, string> = {};
    for (const par of corpo.split(",")) {
      const [chave, ...resto] = par.split("=");
      if (chave) labels[chave] = resto.join("=").replace(/^"|"$/g, "");
    }
    return { name, labels };
  }
}
