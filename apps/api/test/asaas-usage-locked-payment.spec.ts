import { AsaasRecusaException } from "../src/billing/asaas.provider";
import { buildBillingService } from "./support/messaging-services";

/**
 * Cobrança com valor travado pelo Asaas.
 *
 * O que aconteceu em produção: o cliente digitou o cartão na fatura, o Asaas
 * travou o valor daquela cobrança, e o job de consumo tentou somar o uso variável
 * a ela a cada cinco segundos — para sempre. Log cheio de erro idêntico, chamada
 * gasta contra o limite do provedor, e erro de verdade escondido no meio.
 *
 * A recusa é definitiva por natureza: repetir o mesmo pedido dá o mesmo
 * resultado. O consumo então entra na próxima cobrança, que é o comportamento já
 * previsto para quando não existe mensalidade em aberto.
 */
const RECUSA_VALOR_TRAVADO = () => new AsaasRecusaException(
  "O Asaas recusou a operação: Não é possível alterar o valor das cobranças nas quais seu cliente já informou os dados de Cartão de Crédito.",
  400,
  ["invalid_value"],
  ["Não é possível alterar o valor das cobranças nas quais seu cliente já informou os dados de Cartão de Crédito."],
);

function construir(opcoes: { cobrancas?: any[]; recusar?: boolean; instavel?: boolean } = {}) {
  const lancamentos = [
    { id: "uso-1", companyId: "emp-1", metric: "WHATSAPP_SERVICO", quantity: 10, billableAmount: 3.5 },
    { id: "uso-2", companyId: "emp-1", metric: "IA_TOKENS_ENTRADA", quantity: 1000, billableAmount: 1.2 },
  ];
  const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };
  const prisma: any = {
    clientSubscription: {
      findUnique: jest.fn().mockResolvedValue({
        asaasSubscriptionId: "sub_1",
        asaasCustomerId: "cus_1",
        status: "ATIVA",
      }),
    },
    usageLedger,
  };
  const updatePayment = jest.fn().mockImplementation(() => {
    if (opcoes.recusar) return Promise.reject(RECUSA_VALOR_TRAVADO());
    if (opcoes.instavel) return Promise.reject(new AsaasRecusaException("O Asaas recusou a operação.", 502, [], []));
    return Promise.resolve({});
  });
  const asaas = {
    isConfigured: jest.fn().mockReturnValue(true),
    listSubscriptionPayments: jest.fn().mockResolvedValue(opcoes.cobrancas ?? [
      { id: "pay_1", status: "PENDING", value: 159.9, dueDate: "2026-08-25" },
    ]),
    updatePayment,
  };
  const usage = { pendingBillableEntries: jest.fn().mockResolvedValue(lancamentos) };
  const service = buildBillingService({ prisma, asaas, usage }) as any;
  service.onModuleDestroy();
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { service, asaas, updatePayment, usageLedger };
}

describe("consumo variável na cobrança do Asaas", () => {
  it("soma o consumo à mensalidade em aberto", async () => {
    const { service, updatePayment, usageLedger } = construir();

    await service.syncVariableUsageToAsaas();

    expect(updatePayment).toHaveBeenCalledWith("pay_1", expect.objectContaining({ value: 164.6 }));
    expect(usageLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "SINCRONIZADO", asaasPaymentId: "pay_1" },
    }));
  });

  it("cobrança em análise de risco não é escolhida", async () => {
    // Para chegar em análise de risco o cliente já enviou o cartão, e é isso que
    // trava o valor. Tentar era garantia de recusa.
    const { service, updatePayment, usageLedger } = construir({
      cobrancas: [{ id: "pay_risco", status: "AWAITING_RISK_ANALYSIS", value: 159.9, dueDate: "2026-08-25" }],
    });

    await service.syncVariableUsageToAsaas();

    expect(updatePayment).not.toHaveBeenCalled();
    expect(usageLedger.updateMany).not.toHaveBeenCalled();
  });

  it("recusa definitiva não é repetida na rodada seguinte", async () => {
    const { service, updatePayment } = construir({ recusar: true });

    await service.syncVariableUsageToAsaas();
    // A janela por empresa é ignorada aqui para provar o efeito da memória da
    // cobrança: sem ela, a segunda rodada tentaria de novo.
    service.ultimaConferencia.clear();
    await service.syncVariableUsageToAsaas();
    service.ultimaConferencia.clear();
    await service.syncVariableUsageToAsaas();

    expect(updatePayment).toHaveBeenCalledTimes(1);
  });

  it("recusa definitiva é aviso, não erro, e o consumo continua pendente", async () => {
    const { service, usageLedger } = construir({ recusar: true });

    await service.syncVariableUsageToAsaas();

    // Erro repetido no log esconde erro de verdade. Aqui é comportamento
    // previsto: o consumo entra na próxima cobrança.
    expect(service.logger.error).not.toHaveBeenCalled();
    expect(service.logger.warn).toHaveBeenCalledWith(expect.stringContaining("próxima cobrança"));
    expect(usageLedger.updateMany).not.toHaveBeenCalled();
  });

  it("provedor fora do ar continua sendo tentado de novo", async () => {
    // 502 não é recusa: ali repetir é exatamente o certo, e marcar a cobrança
    // como travada faria o consumo nunca mais entrar em fatura nenhuma.
    const { service, updatePayment } = construir({ instavel: true });

    await service.syncVariableUsageToAsaas();
    service.ultimaConferencia.clear();
    await service.syncVariableUsageToAsaas();

    expect(updatePayment).toHaveBeenCalledTimes(2);
    expect(service.logger.error).toHaveBeenCalled();
  });

  it("uma empresa é reconferida no máximo a cada cinco minutos", async () => {
    const { service, asaas } = construir();

    await service.syncVariableUsageToAsaas();
    await service.syncVariableUsageToAsaas();
    await service.syncVariableUsageToAsaas();

    // Sem a janela, a rodada de 5 segundos rendia 17 mil chamadas por dia para
    // fazer sempre a mesma coisa.
    expect(asaas.listSubscriptionPayments).toHaveBeenCalledTimes(1);
  });

  it("sem mensalidade em aberto o consumo acumula, sem erro", async () => {
    const { service, updatePayment } = construir({
      cobrancas: [{ id: "pay_pago", status: "RECEIVED", value: 159.9, dueDate: "2026-07-25" }],
    });

    await service.syncVariableUsageToAsaas();

    expect(updatePayment).not.toHaveBeenCalled();
    expect(service.logger.error).not.toHaveBeenCalled();
  });
});

describe("natureza da recusa do Asaas", () => {
  it("4xx é definitiva", () => {
    expect(new AsaasRecusaException("x", 400, [], []).permanente).toBe(true);
    expect(new AsaasRecusaException("x", 404, [], []).permanente).toBe(true);
    expect(new AsaasRecusaException("x", 422, [], []).permanente).toBe(true);
  });

  it("erro de negócio com HTTP 200 também é definitivo", () => {
    // O Asaas responde 200 com `errors` no corpo em alguns casos; repetir dá o
    // mesmo resultado.
    expect(new AsaasRecusaException("x", 0, [], []).permanente).toBe(true);
  });

  it("5xx e rede não são definitivos", () => {
    expect(new AsaasRecusaException("x", 500, [], []).permanente).toBe(false);
    expect(new AsaasRecusaException("x", 502, [], []).permanente).toBe(false);
    expect(new AsaasRecusaException("x", 503, [], []).permanente).toBe(false);
  });

  it("continua sendo capturável como BadGateway", () => {
    // Trocar o tipo quebraria todo `catch` que já existia no caminho do dinheiro.
    const erro = new AsaasRecusaException("x", 400, [], []);
    expect(erro.getStatus()).toBe(502);
  });

  it("procura código e descrição sem acento e sem caixa", () => {
    const erro = RECUSA_VALOR_TRAVADO();
    expect(erro.contem("invalid_value")).toBe(true);
    expect(erro.contem("informou os dados de cartao")).toBe(true);
    expect(erro.contem("saldo insuficiente")).toBe(false);
  });
});

/**
 * Empresa desativada não tem consumo levado à fatura.
 *
 * Foi o que produziu o laço em produção: a empresa de teste tinha sido desativada
 * no super admin, mas desativar não cancelava a assinatura, então ela seguia
 * ATIVA — e o job tratava a conta desligada como cliente pagante. Depender do
 * status da assinatura para decidir isso é frágil; quem manda é a empresa estar
 * ativa.
 */
describe("empresa desativada no consumo variável", () => {
  function construirComEmpresa(isActive: boolean) {
    const usageLedger = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    const prisma: any = {
      clientSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          asaasSubscriptionId: "sub_1",
          asaasCustomerId: "cus_1",
          status: "ATIVA",
          company: { isActive },
        }),
      },
      usageLedger,
    };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      listSubscriptionPayments: jest.fn().mockResolvedValue([
        { id: "pay_1", status: "PENDING", value: 159.9, dueDate: "2026-08-25" },
      ]),
      updatePayment: jest.fn().mockResolvedValue({}),
    };
    const usage = {
      pendingBillableEntries: jest.fn().mockResolvedValue([
        { id: "uso-1", companyId: "emp-1", metric: "WHATSAPP_SERVICO", quantity: 10, billableAmount: 3.5 },
      ]),
    };
    const service = buildBillingService({ prisma, asaas, usage }) as any;
    service.onModuleDestroy();
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { service, asaas, usageLedger };
  }

  it("empresa desativada não chega ao provedor", async () => {
    const { service, asaas, usageLedger } = construirComEmpresa(false);

    await service.syncVariableUsageToAsaas();

    expect(asaas.listSubscriptionPayments).not.toHaveBeenCalled();
    expect(asaas.updatePayment).not.toHaveBeenCalled();
    // O lançamento fica pendente, como registro do que foi consumido.
    expect(usageLedger.updateMany).not.toHaveBeenCalled();
  });

  it("o aviso sai uma vez a cada seis horas, não a cada rodada", async () => {
    const { service } = construirComEmpresa(false);

    await service.syncVariableUsageToAsaas();
    service.ultimaConferencia.delete("consumo-asaas:emp-1");
    await service.syncVariableUsageToAsaas();
    service.ultimaConferencia.delete("consumo-asaas:emp-1");
    await service.syncVariableUsageToAsaas();

    expect(service.logger.log).toHaveBeenCalledTimes(1);
  });

  it("empresa ativa segue normalmente", async () => {
    const { service, asaas } = construirComEmpresa(true);

    await service.syncVariableUsageToAsaas();

    expect(asaas.updatePayment).toHaveBeenCalledWith("pay_1", expect.objectContaining({ value: 163.4 }));
  });
});
