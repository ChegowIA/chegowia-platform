import { AsaasProvider } from "../src/billing/asaas.provider";

/**
 * O ambiente do Asaas vem da própria chave: `$aact_prod_` só responde em
 * api.asaas.com e `$aact_hmlg_` só em api-sandbox. Apontar para o host errado
 * devolve 401, que é a confusão mais comum na configuração — por isso deduzimos
 * a URL da chave em vez de pedir mais uma variável.
 */
describe("cliente do Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };
  let provider: AsaasProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.ASAAS_API_KEY = "$aact_hmlg_chave-de-teste";
    delete process.env.ASAAS_API_BASE_URL;
    provider = new AsaasProvider();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: "cus_1" }) });
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function chamada() {
    return { url: fetchMock.mock.calls[0][0] as string, init: fetchMock.mock.calls[0][1] as any };
  }

  it("usa o sandbox com chave de homologação", async () => {
    await provider.createCustomer({ name: "Loja", email: "a@b.c", cpfCnpj: "12345678000199" });
    expect(chamada().url).toContain("https://api-sandbox.asaas.com/v3");
    expect(provider.isProduction()).toBe(false);
  });

  it("usa produção com chave de produção", async () => {
    process.env.ASAAS_API_KEY = "$aact_prod_chave-real";
    const real = new AsaasProvider();
    await real.createCustomer({ name: "Loja", email: "a@b.c", cpfCnpj: "12345678000199" });
    expect(chamada().url).toContain("https://api.asaas.com/v3");
    expect(real.isProduction()).toBe(true);
  });

  it("autentica pelo header access_token", async () => {
    await provider.createCustomer({ name: "Loja", email: "a@b.c", cpfCnpj: "12345678000199" });
    expect(chamada().init.headers.access_token).toBe("$aact_hmlg_chave-de-teste");
  });

  it("assina mensalmente por padrão, já que todo plano é mensal", async () => {
    await provider.createSubscription({ customer: "cus_1", value: 159.9, nextDueDate: "2026-09-01" });
    expect(JSON.parse(chamada().init.body)).toEqual(expect.objectContaining({ cycle: "MONTHLY" }));
  });

  it("recusa erro de negócio que vem com HTTP 200", async () => {
    // O Asaas devolve 200 com `errors` em parte das recusas; confiar no código
    // HTTP faria a cobrança ser dada como criada sem existir.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errors: [{ description: "CPF/CNPJ inválido" }] }),
    });

    await expect(
      provider.createCustomer({ name: "Loja", email: "a@b.c", cpfCnpj: "1" }),
    ).rejects.toThrow("CPF/CNPJ inválido");
  });

  it("exige a carteira ao criar subconta, sem a qual não há como transferir comissão", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ id: "acc_1" }) });

    await expect(
      provider.createSubaccount({ name: "Rev", email: "r@b.c", cpfCnpj: "12345678909", incomeValue: 5000 }),
    ).rejects.toThrow("carteira");
  });

  it("falha claramente sem chave configurada", async () => {
    delete process.env.ASAAS_API_KEY;
    const semChave = new AsaasProvider();
    expect(semChave.isConfigured()).toBe(false);
    await expect(
      semChave.createCustomer({ name: "Loja", email: "a@b.c", cpfCnpj: "12345678000199" }),
    ).rejects.toThrow("ASAAS_API_KEY");
  });

  it("distingue cobrança inexistente de falha de rede", async () => {
    // Confundir as duas faria o consumo já faturado voltar para a fila e ser
    // cobrado duas vezes.
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    await expect(provider.findPayment("pay_1")).resolves.toBeNull();

    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await expect(provider.findPayment("pay_1")).rejects.toThrow();
  });

  it("consulta apenas uma antecipação já creditada para a cobrança", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: "ant_1", payment: "pay_1", status: "CREDITED", netValue: 142.37 }],
      }),
    });

    await expect(provider.findCreditedAnticipationForPayment("pay_1")).resolves.toEqual({
      id: "ant_1",
      payment: "pay_1",
      status: "CREDITED",
      netValue: 142.37,
    });
    expect(chamada().url).toContain("/anticipations?payment=pay_1&status=CREDITED&limit=1");
  });
});
