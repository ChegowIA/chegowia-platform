import * as forge from "node-forge";
import {
  FiscalDocumentStatus,
  FiscalEmissionType,
  FiscalEnvironment,
  PaymentMethod,
  TaxOrigin,
  TaxRegime,
} from "@prisma/client";
import { NfceService } from "../src/fiscal/nfce/nfce.service";
import { SefazUnavailableError } from "../src/fiscal/nfce/sefaz-client";
import { extractKeyPair, signXml } from "../src/fiscal/nfce/xml-signer";

/** Certificado autoassinado real, para exercitar a assinatura de verdade. */
function certificado() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: "LOJA TESTE:12345678000199" }]);
  cert.setIssuer([{ name: "commonName", value: "AC TESTE" }]);
  cert.sign(keys.privateKey);
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "senha", { algorithm: "3des" });
  return { pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), password: "senha" };
}

describe("assinatura XMLDSig", () => {
  const material = certificado();

  it("assina com os algoritmos que a SEFAZ exige, não com os mais modernos", () => {
    const chaves = extractKeyPair(material);
    const xml = '<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">'
      + '<infNFe versao="4.00" Id="NFe123"><ide><cUF>31</cUF></ide></infNFe></NFe>';

    const assinado = signXml(xml, "NFe123", "NFe", chaves);

    expect(assinado).toContain("rsa-sha1");
    expect(assinado).toContain("xmldsig#sha1");
    expect(assinado).toContain("enveloped-signature");
    expect(assinado).not.toContain("rsa-sha256");
  });

  it("a Signature fica dentro de NFe, irmã de infNFe", () => {
    const chaves = extractKeyPair(material);
    const xml = '<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">'
      + '<infNFe versao="4.00" Id="NFe123"><ide><cUF>31</cUF></ide></infNFe></NFe>';

    const assinado = signXml(xml, "NFe123", "NFe", chaves);

    expect(assinado.indexOf("</infNFe>")).toBeLessThan(assinado.indexOf("<Signature"));
    expect(assinado.indexOf("<Signature")).toBeLessThan(assinado.indexOf("</NFe>"));
  });

  it("o certificado vai no KeyInfo sem cabeçalho PEM", () => {
    const chaves = extractKeyPair(material);
    const xml = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe123"><a>1</a></infNFe></NFe>';

    const assinado = signXml(xml, "NFe123", "NFe", chaves);

    expect(assinado).toContain("<X509Certificate>");
    expect(assinado).not.toContain("BEGIN CERTIFICATE");
  });

  it("senha errada não abre o certificado", () => {
    expect(() => extractKeyPair({ pfx: material.pfx, password: "errada" })).toThrow();
  });
});

describe("serviço de emissão", () => {
  const tributacaoOk = {
    ncm: "21069090", cest: null, cfop: "5102", taxOrigin: TaxOrigin.NACIONAL,
    icmsCode: "102", icmsRate: null, pisCode: "49", pisRate: 0,
    cofinsCode: "49", cofinsRate: 0, unit: "UN",
  };

  const perfil = {
    id: "perfil-1",
    taxRegime: TaxRegime.SIMPLES_NACIONAL,
    environment: FiscalEnvironment.HOMOLOGACAO,
    nfceSeries: 1,
    nfceNextNumber: 42,
    legalName: "Loja Teste Ltda",
    tradeName: null,
    stateRegistration: "ISENTO",
    addressStreet: "Rua A",
    addressNumber: "10",
    addressComplement: null,
    addressDistrict: "Centro",
    cityIbgeCode: "3106200",
    cityName: "Belo Horizonte",
    state: "MG",
    zipCode: "30130000",
    defaultNcm: "21069090",
    defaultCest: null,
    defaultCfop: "5102",
    defaultTaxOrigin: TaxOrigin.NACIONAL,
    defaultIcmsCode: "102",
    defaultIcmsRate: null,
    defaultPisCode: "49",
    defaultPisRate: 0,
    defaultCofinsCode: "49",
    defaultCofinsRate: 0,
    defaultUnit: "UN",
  };

  const pedido = {
    id: "pedido-1",
    companyId: "empresa-1",
    paymentMethod: PaymentMethod.DINHEIRO,
    deliveryFee: 5,
    discount: 0,
    total: 55,
    items: [{ productId: "prod-1", productName: "Prato", quantity: 2, totalPrice: 50 }],
    customer: { document: null, name: "Cliente" },
  };

  function build(overrides: any = {}) {
    const material = certificado();
    const documentos = new Map<string, any>();
    let sequencia = perfil.nfceNextNumber;

    const prisma: any = {
      companyFiscalProfile: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({ ...(overrides.profile ?? perfil), nfceNextNumber: sequencia })),
        updateMany: jest.fn().mockImplementation(({ where }: any) => {
          if (where.nfceNextNumber !== sequencia) return Promise.resolve({ count: 0 });
          sequencia += 1;
          return Promise.resolve({ count: 1 });
        }),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ cnpj: "12345678000199", phone: null, name: "Loja" }) },
      order: { findFirst: jest.fn().mockResolvedValue(overrides.order ?? pedido) },
      product: {
        findMany: jest.fn().mockResolvedValue(overrides.products ?? [{ id: "prod-1", ...tributacaoOk }]),
      },
      fiscalDocument: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(documentos.get(where.id ?? where.orderId) ?? null)),
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(documentos.get(where.id) ?? null)),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const doc = { id: "doc-1", attempts: 0, createdAt: new Date(), ...data };
          documentos.set("doc-1", doc);
          if (data.orderId) documentos.set(data.orderId, doc);
          return Promise.resolve(doc);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const atual = documentos.get(where.id) ?? {};
          const proximo = { ...atual, ...data };
          if (data.attempts?.increment) proximo.attempts = (atual.attempts ?? 0) + data.attempts.increment;
          documentos.set(where.id, proximo);
          return Promise.resolve(proximo);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          const atual = documentos.get(where.id);
          if (!atual) return Promise.resolve({ count: 0 });
          if (where.status?.in && !where.status.in.includes(atual.status)) return Promise.resolve({ count: 0 });
          const proximo = { ...atual, ...data };
          if (data.attempts?.increment) proximo.attempts = (atual.attempts ?? 0) + data.attempts.increment;
          documentos.set(where.id, proximo);
          return Promise.resolve({ count: 1 });
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      fiscalDocumentEvent: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: "evt-1", ...data })),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const fiscal = {
      loadSigningMaterial: jest.fn().mockResolvedValue({ ...material, notAfter: new Date(Date.now() + 86_400_000) }),
      loadCsc: jest.fn().mockResolvedValue({ cscId: "000001", token: "TOKEN-CSC-DE-TESTE-1234" }),
    };
    const sefaz = {
      sendAuthorization: overrides.sendAuthorization
        ?? jest.fn().mockResolvedValue({
          code: "104",
          reason: "Lote processado",
          xml: "<retEnviNFe><cStat>104</cStat><protNFe><infProt><cStat>100</cStat>"
            + "<xMotivo>Autorizado o uso da NF-e</xMotivo><nProt>131260000123456</nProt></infProt></protNFe></retEnviNFe>",
        }),
      sendEvent: overrides.sendEvent ?? jest.fn(),
      sendInutilization: overrides.sendInutilization ?? jest.fn(),
    };
    const mail = { sendOperationsAlert: jest.fn().mockResolvedValue(undefined) };

    const service = new NfceService(prisma as never, fiscal as never, sefaz as never, mail as never);
    service.onModuleDestroy();
    return { service, prisma, sefaz, fiscal, mail, documentos };
  }

  it("emite, assina e autoriza um pedido", async () => {
    const { service, sefaz } = build();

    const resultado: any = await service.emitForOrder("empresa-1", "pedido-1");

    expect(sefaz.sendAuthorization).toHaveBeenCalled();
    expect(resultado.status).toBe(FiscalDocumentStatus.AUTORIZADA);
    expect(resultado.protocolNumber).toBe("131260000123456");
    expect(resultado.accessKey).toHaveLength(44);
  });

  it("o XML enviado está assinado", async () => {
    const { service, sefaz } = build();

    await service.emitForOrder("empresa-1", "pedido-1");

    const [, xmlEnviado] = (sefaz.sendAuthorization as jest.Mock).mock.calls[0];
    expect(xmlEnviado).toContain("<Signature");
    expect(xmlEnviado).toContain("<DigestValue>");
  });

  it("emitir duas vezes o mesmo pedido não gera duas notas", async () => {
    const { service, sefaz } = build();

    await service.emitForOrder("empresa-1", "pedido-1");
    await service.emitForOrder("empresa-1", "pedido-1");

    expect(sefaz.sendAuthorization).toHaveBeenCalledTimes(1);
  });

  it("SEFAZ indisponível vira contingência offline, não erro para o caixa", async () => {
    const { service } = build({
      sendAuthorization: jest.fn().mockRejectedValue(new SefazUnavailableError("timeout")),
    });

    const resultado: any = await service.emitForOrder("empresa-1", "pedido-1");

    expect(resultado.status).toBe(FiscalDocumentStatus.CONTINGENCIA);
    expect(resultado.emissionType).toBe(FiscalEmissionType.CONTINGENCIA_OFFLINE);
    // A chave da contingência tem tpEmis 9 na posição 35.
    expect(resultado.accessKey[34]).toBe("9");
  });

  it("rejeição vira mensagem acionável em vez do texto cru da SEFAZ", async () => {
    const { service } = build({
      sendAuthorization: jest.fn().mockResolvedValue({
        code: "104",
        reason: "Lote processado",
        xml: "<retEnviNFe><protNFe><infProt><cStat>209</cStat>"
          + "<xMotivo>Rejeicao: IE do emitente invalida</xMotivo></infProt></protNFe></retEnviNFe>",
      }),
    });

    const resultado: any = await service.emitForOrder("empresa-1", "pedido-1");

    expect(resultado.status).toBe(FiscalDocumentStatus.REJEITADA);
    expect(resultado.actionHint).toContain("Painel > Fiscal");
  });

  it("produto sem tributação completa é recusado antes de queimar numeração", async () => {
    const { service, prisma } = build({
      products: [{ id: "prod-1", ...tributacaoOk, ncm: null }],
      profile: { ...perfil, defaultNcm: null },
    });

    await expect(service.emitForOrder("empresa-1", "pedido-1")).rejects.toThrow(/tributação/);
    expect(prisma.fiscalDocument.create).not.toHaveBeenCalled();
  });

  it("a numeração avança a cada emissão", async () => {
    const { service, prisma } = build();

    await service.emitForOrder("empresa-1", "pedido-1");

    expect(prisma.companyFiscalProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ nfceNextNumber: 42 }) }),
    );
  });

  it("o documento é registrado antes de qualquer falha — número queimado não some", async () => {
    const { service, prisma } = build({
      sendAuthorization: jest.fn().mockRejectedValue(new Error("erro qualquer")),
    });

    await expect(service.emitForOrder("empresa-1", "pedido-1")).rejects.toThrow();
    expect(prisma.fiscalDocument.create).toHaveBeenCalled();
  });

  describe("cancelamento", () => {
    function comNotaAutorizada(minutosAtras: number, sendEvent?: any) {
      const contexto = build({ sendEvent });
      contexto.documentos.set("doc-1", {
        id: "doc-1",
        companyId: "empresa-1",
        status: FiscalDocumentStatus.AUTORIZADA,
        accessKey: "31260812345678000199650010000000421123456780",
        protocolNumber: "131260000123456",
        environment: FiscalEnvironment.HOMOLOGACAO,
        authorizedAt: new Date(Date.now() - minutosAtras * 60_000),
        issuedAt: new Date(),
      });
      return contexto;
    }

    it("recusa justificativa curta antes de gastar uma chamada à SEFAZ", async () => {
      const { service, sefaz } = comNotaAutorizada(1);

      await expect(service.cancel("empresa-1", "doc-1", "errei", "user-1")).rejects.toThrow(/15 caracteres/);
      expect(sefaz.sendEvent).not.toHaveBeenCalled();
    });

    it("recusa fora da janela de 30 minutos, explicando a alternativa", async () => {
      const { service } = comNotaAutorizada(45);

      await expect(service.cancel("empresa-1", "doc-1", "Cliente desistiu da compra", "user-1"))
        .rejects.toThrow(/30 minutos/);
    });

    it("registra o cancelamento dentro da janela", async () => {
      const { service, prisma } = comNotaAutorizada(5, jest.fn().mockResolvedValue({
        code: "128",
        reason: "Lote de evento processado",
        xml: "<retEnvEvento><retEvento><infEvento><cStat>135</cStat>"
          + "<xMotivo>Evento registrado</xMotivo><nProt>131260000999</nProt></infEvento></retEvento></retEnvEvento>",
      }));

      const resultado = await service.cancel("empresa-1", "doc-1", "Cliente desistiu da compra", "user-1");

      expect(resultado.success).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("nota não autorizada não pode ser cancelada", async () => {
      const { service, documentos } = build();
      documentos.set("doc-1", { id: "doc-1", companyId: "empresa-1", status: FiscalDocumentStatus.REJEITADA });

      await expect(service.cancel("empresa-1", "doc-1", "Justificativa suficiente aqui", "user-1"))
        .rejects.toThrow(/autorizada/);
    });
  });

  describe("inutilização", () => {
    it("recusa faixa que contém nota autorizada", async () => {
      const { service, prisma } = build();
      prisma.fiscalDocument.count.mockResolvedValue(2);

      await expect(service.inutilize("empresa-1", { start: 1, end: 10, reason: "Numeracao queimada por rejeicao" }, "u1"))
        .rejects.toThrow(/já usada/);
    });

    it("recusa faixa invertida", async () => {
      const { service } = build();

      await expect(service.inutilize("empresa-1", { start: 10, end: 1, reason: "Numeracao queimada por rejeicao" }, "u1"))
        .rejects.toThrow(/menor que a inicial/);
    });

    it("recusa justificativa curta", async () => {
      const { service } = build();

      await expect(service.inutilize("empresa-1", { start: 1, end: 2, reason: "erro" }, "u1"))
        .rejects.toThrow(/15 caracteres/);
    });
  });
});
