import { BadRequestException } from "@nestjs/common";
import { buildBillingService } from "./support/messaging-services";

/**
 * Subconta do revendedor e repasse da comissão pelo Asaas.
 *
 * O ponto sensível é a idempotência: a API do Asaas não aceita chave de
 * idempotência como a Stripe. Uma resposta perdida depois de a transferência
 * sair pagaria o revendedor duas vezes, e uma criação de subconta interrompida
 * travaria o cadastro para sempre. Os dois casos são resolvidos consultando
 * antes de criar.
 */
describe("recebimento do revendedor pelo Asaas", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "ASAAS";
    delete process.env.ASAAS_SUBACCOUNT_ENCRYPTION_KEY;
    delete process.env.FISCAL_ENCRYPTION_KEY;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const revendedor = {
    id: "rev-1",
    userId: "user-1",
    asaasWalletId: null,
    user: { name: "Ana", email: "ana@rev.com.br", phone: "62999990000", document: "12345678909" },
    application: { document: "12345678909", phone: "62999990000", name: "Ana" },
  };

  const dadosDaConta = {
    postalCode: "74000000",
    address: "Rua 15",
    addressNumber: "120",
    province: "Setor Central",
    incomeValue: 5000,
    birthDate: "1990-05-10",
  };

  function build(overrides: { reseller?: any; asaas?: any } = {}) {
    const resellerProfile = {
      findUnique: jest.fn().mockResolvedValue("reseller" in overrides ? overrides.reseller : revendedor),
      update: jest.fn().mockResolvedValue({}),
    };
    const prisma = { resellerProfile };
    const asaas = {
      isConfigured: jest.fn().mockReturnValue(true),
      createSubaccount: jest.fn().mockResolvedValue({ id: "acc_1", walletId: "wal_1", apiKey: "$aact_sub_chave" }),
      findSubaccountByDocument: jest.fn().mockResolvedValue(null),
      transferToWallet: jest.fn().mockResolvedValue({ id: "tra_1", status: "PENDING", value: 47.97 }),
      findTransferByReference: jest.fn().mockResolvedValue(null),
      ...(overrides.asaas ?? {}),
    };
    const service = buildBillingService({ prisma, asaas });
    service.onModuleDestroy();
    return { service, resellerProfile, asaas };
  }

  describe("abertura da subconta", () => {
    it("cria a subconta e guarda a carteira", async () => {
      const { service, asaas, resellerProfile } = build();

      const result = await service.connectOnboarding("user-1", dadosDaConta as never);

      expect(asaas.createSubaccount).toHaveBeenCalledWith(
        expect.objectContaining({ cpfCnpj: "12345678909", incomeValue: 5000, birthDate: "1990-05-10" }),
      );
      expect(resellerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ asaasWalletId: "wal_1", asaasOnboardingOk: true }),
        }),
      );
      expect((result as { ready?: boolean }).ready).toBe(true);
    });

    it("descarta a chave da subconta quando não há chave de cifra, em vez de gravar em texto claro", async () => {
      const { service, resellerProfile } = build();

      await service.connectOnboarding("user-1", dadosDaConta as never);

      expect(resellerProfile.update.mock.calls[0][0].data.asaasApiKeyEncrypted).toBeNull();
    });

    it("cifra a chave da subconta quando há chave configurada", async () => {
      process.env.ASAAS_SUBACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
      const { service, resellerProfile } = build();

      await service.connectOnboarding("user-1", dadosDaConta as never);

      const guardado = resellerProfile.update.mock.calls[0][0].data.asaasApiKeyEncrypted as string;
      expect(guardado.startsWith("v1.")).toBe(true);
      expect(guardado).not.toContain("$aact_sub_chave");
    });

    it("recupera a carteira quando a subconta já existia, em vez de travar o revendedor", async () => {
      const { service, resellerProfile, asaas } = build({
        asaas: {
          createSubaccount: jest.fn().mockRejectedValue(new Error("já existe conta com este CPF/CNPJ")),
          findSubaccountByDocument: jest.fn().mockResolvedValue({ id: "acc_9", walletId: "wal_9", apiKey: null }),
        },
      });

      await service.connectOnboarding("user-1", dadosDaConta as never);

      expect(asaas.findSubaccountByDocument).toHaveBeenCalledWith("12345678909");
      expect(resellerProfile.update.mock.calls[0][0].data.asaasWalletId).toBe("wal_9");
    });

    it("propaga o erro quando não existe subconta para recuperar", async () => {
      const { service } = build({
        asaas: { createSubaccount: jest.fn().mockRejectedValue(new Error("CEP inválido")) },
      });

      await expect(service.connectOnboarding("user-1", dadosDaConta as never)).rejects.toThrow("CEP inválido");
    });

    it("diz quais campos faltam em vez de deixar o Asaas recusar", async () => {
      const { service, asaas } = build();

      await expect(
        service.connectOnboarding("user-1", { postalCode: "74000000" } as never),
      ).rejects.toThrow(/endereço/);
      expect(asaas.createSubaccount).not.toHaveBeenCalled();
    });

    it("exige data de nascimento de pessoa física", async () => {
      const { service, asaas } = build();
      const { birthDate: _ignorado, ...semNascimento } = dadosDaConta;

      await expect(service.connectOnboarding("user-1", semNascimento as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(asaas.createSubaccount).not.toHaveBeenCalled();
    });

    it("não recria a subconta de quem já tem carteira", async () => {
      const { service, asaas } = build({
        reseller: { ...revendedor, asaasWalletId: "wal_existente" },
      });

      const result = await service.connectOnboarding("user-1", dadosDaConta as never);

      expect(asaas.createSubaccount).not.toHaveBeenCalled();
      expect((result as { ready?: boolean }).ready).toBe(true);
    });
  });

  describe("status", () => {
    it("informa que a tela precisa coletar os dados quando ainda não há carteira", async () => {
      const { service } = build();
      const status = await service.connectStatus("user-1");
      expect(status).toEqual(expect.objectContaining({ provider: "ASAAS", ready: false, requiresForm: true }));
    });

    it("fica pronto quando a carteira existe", async () => {
      const { service } = build({ reseller: { ...revendedor, asaasWalletId: "wal_1" } });
      const status = await service.connectStatus("user-1");
      expect(status).toEqual(expect.objectContaining({ ready: true, status: "ATIVO", requiresForm: false }));
    });
  });

  describe("transferência do lote", () => {
    const lote = { id: "lote-1", amount: 47.97, reseller: { asaasWalletId: "wal_1" } };

    it("transfere para a carteira usando o lote como referência", async () => {
      const { service, asaas } = build();

      const id = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).toHaveBeenCalledWith({
        value: 47.97,
        walletId: "wal_1",
        externalReference: "payout-lote-1",
      });
      expect(id).toBe("tra_1");
    });

    it("não transfere de novo quando a referência já existe no Asaas", async () => {
      const { service, asaas } = build({
        asaas: {
          findTransferByReference: jest.fn().mockResolvedValue({ id: "tra_antiga", status: "DONE", value: 47.97 }),
        },
      });

      const id = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).not.toHaveBeenCalled();
      expect(id).toBe("tra_antiga");
    });

    it("refaz a transferência que falhou no Asaas", async () => {
      const { service, asaas } = build({
        asaas: {
          findTransferByReference: jest.fn().mockResolvedValue({ id: "tra_ruim", status: "FAILED", value: 47.97 }),
        },
      });

      const id = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).toHaveBeenCalled();
      expect(id).toBe("tra_1");
    });
  });

  describe("solicitação de repasse", () => {
    it("recusa quem ainda não abriu a conta de recebimento", async () => {
      const { service } = build();
      await expect(service.requestPayout("user-1")).rejects.toThrow(/conta de recebimento/);
    });
  });
});
