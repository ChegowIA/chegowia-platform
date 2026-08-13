import { appRole, runsBackgroundJobs } from "../src/common/config/app-role";
import { buildBillingService } from "./support/messaging-services";
import { MaintenanceService } from "../src/common/maintenance/maintenance.service";

/**
 * A fila de cobrança vivia dentro do processo HTTP: reiniciar a API segurava o
 * processamento de dinheiro, e escalar horizontalmente faria cada réplica rodar
 * a mesma fila. `APP_ROLE` separa quem atende requisição de quem processa job.
 */
describe("papel do processo", () => {
  const original = process.env.APP_ROLE;
  afterEach(() => { process.env.APP_ROLE = original; });

  it("sem configuração mantém o comportamento anterior: tudo no mesmo processo", () => {
    delete process.env.APP_ROLE;
    expect(appRole()).toBe("all");
    expect(runsBackgroundJobs()).toBe(true);
  });

  it("valor desconhecido não desliga os jobs por engano", () => {
    process.env.APP_ROLE = "backend";
    expect(appRole()).toBe("all");
    expect(runsBackgroundJobs()).toBe(true);
  });

  it.each([
    ["api", false],
    ["worker", true],
    ["WORKER", true],
    [" api ", false],
  ])("APP_ROLE=%s roda jobs: %s", (value, esperado) => {
    process.env.APP_ROLE = value;
    expect(runsBackgroundJobs()).toBe(esperado);
  });

  describe("efeito nos serviços", () => {
    function billing() {
      // A primeira rodada dispara junto com o onModuleInit; o stub só precisa
      // não explodir para o teste medir o agendamento, não o processamento.
      const vazio = { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
      const prisma = { stripeEvent: vazio, payoutBatch: vazio, usageLedger: vazio };
      return buildBillingService({ prisma: prisma });
    }

    it("réplica de API não liga o worker de cobrança", () => {
      process.env.APP_ROLE = "api";
      const service = billing();
      service.onModuleInit();
      expect((service as any).stripeWorker).toBeUndefined();
      service.onModuleDestroy();
    });

    it("processo worker liga o worker de cobrança", () => {
      process.env.APP_ROLE = "worker";
      const service = billing();
      service.onModuleInit();
      expect((service as any).stripeWorker).toBeDefined();
      service.onModuleDestroy();
    });

    it("réplica de API não agenda a limpeza periódica", () => {
      process.env.APP_ROLE = "api";
      const service = new MaintenanceService({} as never, {} as never);
      service.onModuleInit();
      expect((service as any).interval).toBeUndefined();
      expect((service as any).initialRun).toBeUndefined();
      service.onApplicationShutdown();
    });

    it("processo worker agenda a limpeza periódica", () => {
      process.env.APP_ROLE = "worker";
      const service = new MaintenanceService({} as never, {} as never);
      service.onModuleInit();
      expect((service as any).interval).toBeDefined();
      service.onApplicationShutdown();
    });
  });
});
