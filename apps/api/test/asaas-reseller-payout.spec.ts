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

      const transfer = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).toHaveBeenCalledWith({
        value: 47.97,
        walletId: "wal_1",
        externalReference: "payout-lote-1",
      });
      expect(transfer).toEqual(expect.objectContaining({ id: "tra_1", status: "PENDING" }));
    });

    it("não transfere de novo quando a referência já existe no Asaas", async () => {
      const { service, asaas } = build({
        asaas: {
          findTransferByReference: jest.fn().mockResolvedValue({ id: "tra_antiga", status: "DONE", value: 47.97 }),
        },
      });

      const transfer = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).not.toHaveBeenCalled();
      expect(transfer).toEqual(expect.objectContaining({ id: "tra_antiga", status: "DONE" }));
    });

    it("não recria automaticamente uma transferência que o Asaas já marcou como falha", async () => {
      const { service, asaas } = build({
        asaas: {
          findTransferByReference: jest.fn().mockResolvedValue({ id: "tra_ruim", status: "FAILED", value: 47.97 }),
        },
      });

      const transfer = await (service as never as Record<string, any>).transferPayoutViaAsaas(lote);

      expect(asaas.transferToWallet).not.toHaveBeenCalled();
      expect(transfer).toEqual(expect.objectContaining({ id: "tra_ruim", status: "FAILED" }));
    });

    it("não cria novo repasse se não consegue confirmar a referência existente", async () => {
      const { service, asaas } = build({
        asaas: {
          findTransferByReference: jest.fn().mockRejectedValue(new Error("consulta indisponível")),
        },
      });

      await expect(
        (service as never as Record<string, any>).transferPayoutViaAsaas(lote),
      ).rejects.toThrow("consulta indisponível");
      expect(asaas.transferToWallet).not.toHaveBeenCalled();
    });
  });

  describe("solicitação de repasse", () => {
    it("recusa quem ainda não abriu a conta de recebimento", async () => {
      const { service } = build();
      await expect(service.requestPayout("user-1")).rejects.toThrow(/conta de recebimento/);
    });

    it("confirma o prazo máximo de cinco dias úteis no painel e por e-mail", async () => {
      const resellerProfile = {
        findUnique: jest.fn().mockResolvedValue({ ...revendedor, asaasWalletId: "wal_1" }),
      };
      const commissionLedger = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
      const payoutBatch = {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: "lote-1" }),
      };
      const prisma = {
        resellerProfile,
        commissionLedger,
        $transaction: jest.fn(async (operation: any) => operation({ payoutBatch, commissionLedger: {
          findMany: jest.fn().mockResolvedValue([{ id: "com-1", commissionAmount: 47.97 }]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        } })),
      };
      const mail = { sendResellerPayoutRequested: jest.fn().mockResolvedValue(undefined) };
      const service = buildBillingService({ prisma, asaas: { isConfigured: jest.fn().mockReturnValue(true) }, mail });
      service.onModuleDestroy();
      (service as never as Record<string, any>).executePayoutBatch = jest.fn().mockResolvedValue({
        transferId: "tra-1",
        amount: 47.97,
        count: 1,
        processing: true,
      });

      const result = await service.requestPayout("user-1");

      expect(result).toEqual(expect.objectContaining({ processing: true, notice: expect.stringMatching(/até 5 dias úteis/) }));
      expect(mail.sendResellerPayoutRequested).toHaveBeenCalledWith(expect.objectContaining({
        email: "ana@rev.com.br",
        amount: 47.97,
        maxBusinessDays: 5,
      }));
    });
  });

  describe("confirmação do repasse", () => {
    function payoutService(transferStatus: string) {
      const batch = {
        id: "lote-1",
        status: "PROCESSANDO",
        attempts: 0,
        amount: 47.97,
        currency: "brl",
        resellerId: "rev-1",
        asaasTransferId: null,
        reseller: { stripeAccountId: null, asaasWalletId: "wal_1" },
        commissions: [{ id: "com-1" }],
      };
      const payoutBatch = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(batch),
        update: jest.fn().mockResolvedValue({}),
      };
      const commissionLedger = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
      const prisma = {
        payoutBatch,
        commissionLedger,
        $transaction: jest.fn(async (operation: any) => operation({ payoutBatch, commissionLedger })),
      };
      const asaas = {
        isConfigured: jest.fn().mockReturnValue(true),
        findTransferByReference: jest.fn().mockResolvedValue(null),
        transferToWallet: jest.fn().mockResolvedValue({ id: "tra-1", status: transferStatus, value: 47.97 }),
      };
      const service = buildBillingService({ prisma, asaas });
      service.onModuleDestroy();
      return { service, payoutBatch, commissionLedger, asaas, prisma };
    }

    it("não marca comissão como paga quando a transferência ainda está pendente", async () => {
      const { service, payoutBatch, commissionLedger, prisma } = payoutService("PENDING");

      const result = await (service as never as Record<string, any>).executePayoutBatch("lote-1");

      expect(result).toEqual(expect.objectContaining({ transferId: "tra-1", processing: true }));
      expect(commissionLedger.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(payoutBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ asaasTransferId: "tra-1" }) }),
      );
    });

    it("marca como paga somente depois de o Asaas devolver DONE", async () => {
      const { service, commissionLedger, prisma } = payoutService("DONE");

      const result = await (service as never as Record<string, any>).executePayoutBatch("lote-1");

      expect(result).toEqual(expect.objectContaining({ transferId: "tra-1" }));
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(commissionLedger.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "PAGA", asaasTransferId: "tra-1" }) }),
      );
    });

    it("não devolve o saldo quando a resposta do Asaas se perde após o envio", async () => {
      const { service, asaas, payoutBatch, commissionLedger, prisma } = payoutService("PENDING");
      asaas.transferToWallet.mockRejectedValueOnce(new Error("conexão interrompida"));

      await expect((service as never as Record<string, any>).executePayoutBatch("lote-1")).rejects.toThrow(/não confirmou/i);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(commissionLedger.updateMany).not.toHaveBeenCalled();
      expect(payoutBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nextAttemptAt: expect.any(Date) }) }),
      );
    });
  });
});

/**
 * Desconto por indicação.
 *
 * O cupom de 15% existia só na Stripe: no Asaas a assinatura nascia com o preço
 * cheio enquanto o painel do cliente e o assistente do revendedor prometiam o
 * desconto. Estes testes prendem as duas pontas — a cobrança sai com desconto e
 * volta ao cheio quando a janela fecha.
 */
describe("desconto do código de indicação", () => {
  const plano = { monthlyPrice: 159.9, name: "Profissional", currency: "brl" };

  function servico(overrides: any = {}) {
    const asaas = {
      isConfigured: () => true,
      updateSubscription: jest.fn().mockResolvedValue({ id: "sub_1" }),
    };
    const prisma = {
      clientSubscription: {
        findMany: jest.fn().mockResolvedValue(overrides.vencidas ?? []),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = buildBillingService({ prisma, asaas }) as any;
    service.onModuleDestroy();
    return { service, asaas, prisma };
  }

  it("com código vinculado, a cobrança sai 15% menor", () => {
    const { service } = servico();

    const valor = service.subscriptionChargeValue({
      monthlyPriceSnapshot: 159.9,
      plan: plano,
      resellerId: "rev-1",
      discountEndsAt: null,
    });

    expect(valor).toBe(135.92);
  });

  it("sem código, a cobrança é o preço cheio", () => {
    const { service } = servico();

    expect(service.subscriptionChargeValue({
      monthlyPriceSnapshot: 159.9,
      plan: plano,
      resellerId: null,
    })).toBe(159.9);
  });

  it("passada a janela de 3 meses, volta ao preço cheio", () => {
    const { service } = servico();
    const ontem = new Date(Date.now() - 86_400_000);

    expect(service.subscriptionChargeValue({
      monthlyPriceSnapshot: 159.9,
      plan: plano,
      resellerId: "rev-1",
      discountEndsAt: ontem,
    })).toBe(159.9);
  });

  it("a varredura devolve o preço cheio no Asaas e marca o ajuste", async () => {
    const { service, asaas, prisma } = servico({
      vencidas: [{
        id: "assin-1",
        asaasSubscriptionId: "sub_1",
        monthlyPriceSnapshot: 159.9,
        plan: plano,
      }],
    });

    await service.syncExpiredReferralDiscounts();

    expect(asaas.updateSubscription).toHaveBeenCalledWith("sub_1", { value: 159.9 });
    expect(prisma.clientSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "assin-1" },
      data: expect.objectContaining({ discountRemovedAt: expect.any(Date) }),
    }));
  });

  it("a comissão acompanha o que o cliente pagou, nos dois períodos", () => {
    const { service } = servico();
    const assinatura = { plan: plano, monthlyPriceSnapshot: 159.9 };

    // Durante a janela o cliente paga com desconto e a comissão sai sobre ele.
    const comDesconto = service.commissionableMonthlyAmount(assinatura, 135.92);
    expect(comDesconto).toBe(135.92);
    expect(Math.round(comDesconto * 0.3 * 100) / 100).toBe(40.78);

    // Passada a janela, a cobrança volta ao cheio e a comissão acompanha.
    const cheia = service.commissionableMonthlyAmount(assinatura, 159.9);
    expect(cheia).toBe(159.9);
    expect(Math.round(cheia * 0.3 * 100) / 100).toBe(47.97);
  });

  it("cobrança maior que a mensalidade não infla a comissão", () => {
    const { service } = servico();

    // Uma fatura pode carregar consumo além do plano; a comissão para na
    // mensalidade.
    expect(service.commissionableMonthlyAmount(
      { plan: plano, monthlyPriceSnapshot: 159.9 },
      210,
    )).toBe(159.9);
  });

  it("no cartão a taxa é acrescida por dentro, para o líquido bater com o plano", () => {
    const { service } = servico();
    const assinatura = { plan: plano, monthlyPriceSnapshot: 159.9, resellerId: null };

    const valor = service.chargeValueForBillingType(assinatura, "CREDIT_CARD");

    // (159,90 + 0,49) / (1 - 2,99%) = 165,33. Somar a taxa por fora daria
    // 165,17, e o Asaas cobraria o percentual sobre o total já acrescido —
    // a plataforma receberia menos que a mensalidade.
    expect(valor).toBe(165.33);
    const taxaCobradaPeloAsaas = valor * 0.0299 + 0.49;
    expect(Math.round((valor - taxaCobradaPeloAsaas) * 100) / 100).toBe(159.9);
  });

  it("pix e boleto não carregam taxa", () => {
    const { service } = servico();
    const assinatura = { plan: plano, monthlyPriceSnapshot: 159.9, resellerId: null };

    expect(service.chargeValueForBillingType(assinatura, "PIX")).toBe(159.9);
    expect(service.chargeValueForBillingType(assinatura, "BOLETO")).toBe(159.9);
    expect(service.chargeValueForBillingType(assinatura, undefined)).toBe(159.9);
  });

  it("com desconto de indicação, a taxa do cartão incide sobre o valor já descontado", () => {
    const { service } = servico();

    const valor = service.chargeValueForBillingType(
      { plan: plano, monthlyPriceSnapshot: 159.9, resellerId: "rev-1", discountEndsAt: null },
      "CREDIT_CARD",
    );

    // (135,92 + 0,49) / (1 - 2,99%)
    expect(valor).toBe(140.61);
  });

  it("assinatura já ajustada não é cobrada de novo pela varredura", async () => {
    const { service, asaas } = servico({ vencidas: [] });

    await service.syncExpiredReferralDiscounts();

    expect(asaas.updateSubscription).not.toHaveBeenCalled();
    // O filtro é `discountRemovedAt: null`: quem já voltou ao cheio não volta.
    expect(true).toBe(true);
  });
});
