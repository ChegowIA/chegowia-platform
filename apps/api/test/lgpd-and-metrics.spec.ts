import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { UsersService } from "../src/users/users.service";
import { MetricsService } from "../src/common/observability/metrics.service";

/**
 * Exclusão de conta pelo titular (LGPD art. 18, VI).
 *
 * A escolha central é anonimizar em vez de apagar: pedido é documento fiscal
 * com guarda obrigatória de cinco anos, e deletar a linha destruiria o
 * histórico de vendas do restaurante junto com o dado pessoal.
 */
describe("exclusão de conta", () => {
  async function build(overrides: any = {}) {
    const hash = await bcrypt.hash("SenhaCerta@1", 4);
    const chamadas: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.user ?? { id: "user-1", role: Role.CLIENTE, passwordHash: hash },
        ),
        update: jest.fn().mockImplementation((args: any) => { chamadas.push(["user.update", args]); return args; }),
      },
      address: { deleteMany: jest.fn().mockImplementation((a: any) => { chamadas.push(["address.deleteMany", a]); return a; }) },
      refreshToken: { updateMany: jest.fn().mockImplementation((a: any) => a) },
      accountToken: { updateMany: jest.fn().mockImplementation((a: any) => a) },
      order: { updateMany: jest.fn().mockImplementation((a: any) => { chamadas.push(["order.updateMany", a]); return a; }) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const realtime = { disconnectUser: jest.fn() };
    const service = new UsersService(prisma as never, {} as never, realtime as never);
    return { service, prisma, realtime, chamadas };
  }

  it("anonimiza o usuário em vez de apagar", async () => {
    const { service, chamadas } = await build();

    await service.deleteMyAccount("user-1", "SenhaCerta@1");

    const [, args] = chamadas.find(([nome]) => nome === "user.update");
    expect(args.data.name).toBe("Cliente removido");
    expect(args.data.email).toMatch(/@removido\.local$/);
    expect(args.data.document).toBeNull();
    expect(args.data.isActive).toBe(false);
  });

  it("o e-mail anonimizado é único — dois titulares não colidem", async () => {
    const primeiro = await build();
    const segundo = await build();

    await primeiro.service.deleteMyAccount("user-1", "SenhaCerta@1");
    await segundo.service.deleteMyAccount("user-1", "SenhaCerta@1");

    const emailA = primeiro.chamadas.find(([n]) => n === "user.update")[1].data.email;
    const emailB = segundo.chamadas.find(([n]) => n === "user.update")[1].data.email;
    expect(emailA).not.toBe(emailB);
  });

  it("o endereço de entrega gravado no pedido também é anonimizado", async () => {
    const { service, chamadas } = await build();

    await service.deleteMyAccount("user-1", "SenhaCerta@1");

    const [, args] = chamadas.find(([nome]) => nome === "order.updateMany");
    expect(args.data.deliveryStreet).toContain("Removido");
    expect(args.data.deliveryComplement).toBeNull();
  });

  it("os pedidos não são apagados — guarda fiscal de cinco anos", async () => {
    const { service, prisma } = await build();

    await service.deleteMyAccount("user-1", "SenhaCerta@1");

    expect(prisma.order.updateMany).toHaveBeenCalled();
    expect((prisma.order as any).deleteMany).toBeUndefined();
  });

  it("senha errada não encerra a conta", async () => {
    const { service, prisma } = await build();

    await expect(service.deleteMyAccount("user-1", "SenhaErrada@1")).rejects.toThrow(/Senha incorreta/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("conta vinculada a empresa passa pelo desligamento, não por aqui", async () => {
    const hash = await bcrypt.hash("SenhaCerta@1", 4);
    const { service } = await build({ user: { id: "user-1", role: Role.ADMIN, passwordHash: hash } });

    await expect(service.deleteMyAccount("user-1", "SenhaCerta@1"))
      .rejects.toThrow(/administrador/);
  });

  it("derruba as sessões ao encerrar", async () => {
    const { service, realtime } = await build();

    await service.deleteMyAccount("user-1", "SenhaCerta@1");

    expect(realtime.disconnectUser).toHaveBeenCalledWith("user-1", expect.stringContaining("titular"));
  });
});

describe("métricas", () => {
  it("expõe contador no formato do Prometheus", () => {
    const metrics = new MetricsService();

    metrics.increment("chegowia_http_requests_total", { method: "GET", route: "/api/orders", status: "200" });
    metrics.increment("chegowia_http_requests_total", { method: "GET", route: "/api/orders", status: "200" });

    expect(metrics.render()).toContain(
      'chegowia_http_requests_total{method="GET",route="/api/orders",status="200"} 2',
    );
  });

  it("histograma acumula os buckets corretamente", () => {
    const metrics = new MetricsService();

    metrics.observe("latencia", 0.03);
    metrics.observe("latencia", 0.4);
    metrics.observe("latencia", 30);

    const saida = metrics.render();
    expect(saida).toContain('latencia_bucket{le="0.05"} 1');
    expect(saida).toContain('latencia_bucket{le="0.5"} 2');
    // O de 30s fica acima do último bucket e só aparece no +Inf.
    expect(saida).toContain('latencia_bucket{le="+Inf"} 3');
    expect(saida).toContain("latencia_count 3");
  });

  it("gauge é substituído, não somado", () => {
    const metrics = new MetricsService();

    metrics.setGauge("fila", 5);
    metrics.setGauge("fila", 2);

    expect(metrics.render()).toContain("fila 2");
  });

  it("aspas em label não quebram o formato de exposição", () => {
    const metrics = new MetricsService();

    metrics.increment("teste", { route: 'com"aspas' });

    expect(metrics.render()).not.toContain('com"aspas');
  });

  it("sempre inclui uptime e memória", () => {
    const saida = new MetricsService().render();

    expect(saida).toContain("chegowia_process_uptime_seconds");
    expect(saida).toContain("chegowia_process_heap_used_bytes");
  });
});
