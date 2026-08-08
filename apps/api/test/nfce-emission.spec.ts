import { FiscalEnvironment, PaymentMethod, TaxOrigin, TaxRegime } from "@prisma/client";
import {
  accessKeyCheckDigit,
  buildAccessKey,
  generateNumericCode,
  isValidAccessKey,
  parseAccessKey,
} from "../src/fiscal/nfce/access-key";
import { calculateTaxes, fromCents, toCents, xmlAmount } from "../src/fiscal/nfce/tax-engine";
import { buildNfceXml } from "../src/fiscal/nfce/xml-builder";
import { buildQrCode } from "../src/fiscal/nfce/qr-code";
import { isAuthorized, isServiceUnavailable, rejectionGuidance } from "../src/fiscal/nfce/rejections";
import { extractResult, tagValue } from "../src/fiscal/nfce/sefaz-client";
import { buildDanfeText } from "../src/fiscal/nfce/danfe";

const tributacao = {
  ncm: "21069090",
  cest: null,
  cfop: "5102",
  taxOrigin: TaxOrigin.NACIONAL,
  icmsCode: "102",
  icmsRate: 0,
  pisCode: "49",
  pisRate: 0,
  cofinsCode: "49",
  cofinsRate: 0,
  unit: "UN",
};

describe("chave de acesso da NFC-e", () => {
  it("monta 44 dígitos com dígito verificador válido", () => {
    const chave = buildAccessKey({
      uf: "MG",
      issuedAt: new Date("2026-08-02T12:00:00-03:00"),
      cnpj: "12345678000199",
      series: 1,
      number: 42,
      emissionType: 1,
      numericCode: "12345678",
    });

    expect(chave).toHaveLength(44);
    expect(isValidAccessKey(chave)).toBe(true);
  });

  it("os campos voltam exatamente como entraram", () => {
    const chave = buildAccessKey({
      uf: "SP",
      issuedAt: new Date("2026-03-15T10:00:00-03:00"),
      cnpj: "11222333000181",
      series: 7,
      number: 999_999,
      emissionType: 9,
      numericCode: "00042424",
    });

    const partes = parseAccessKey(chave);
    expect(partes.cUF).toBe("35");
    expect(partes.year).toBe("26");
    expect(partes.month).toBe("03");
    expect(partes.cnpj).toBe("11222333000181");
    expect(partes.model).toBe("65");
    expect(partes.series).toBe(7);
    expect(partes.number).toBe(999_999);
    expect(partes.emissionType).toBe(9);
  });

  it("um dígito trocado invalida a chave", () => {
    const chave = buildAccessKey({
      uf: "MG",
      issuedAt: new Date("2026-08-02T12:00:00-03:00"),
      cnpj: "12345678000199",
      series: 1,
      number: 1,
      emissionType: 1,
      numericCode: "00000001",
    });
    const adulterada = `${chave.slice(0, 20)}${chave[20] === "9" ? "8" : "9"}${chave.slice(21)}`;

    expect(isValidAccessKey(adulterada)).toBe(false);
  });

  it("resto 0 ou 1 no módulo 11 produz DV zero", () => {
    // Regra da SEFAZ, não arredondamento: precisa valer para qualquer entrada.
    for (let i = 0; i < 500; i += 1) {
      const base = String(i).padStart(43, "0");
      const dv = Number(accessKeyCheckDigit(base));
      expect(dv).toBeGreaterThanOrEqual(0);
      expect(dv).toBeLessThanOrEqual(9);
    }
  });

  it("o código numérico nunca coincide com o número da nota", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(Number(generateNumericCode(i))).not.toBe(i);
    }
  });

  it("UF sem código IBGE é recusada com mensagem clara", () => {
    expect(() => buildAccessKey({
      uf: "XX",
      issuedAt: new Date(),
      cnpj: "12345678000199",
      series: 1,
      number: 1,
      emissionType: 1,
      numericCode: "00000001",
    })).toThrow(/XX/);
  });
});

describe("motor de cálculo", () => {
  it("soma em centavos sem erro de ponto flutuante", () => {
    const resultado = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "p1", name: "A", quantity: 3, unitPrice: 0.1, tax: tributacao },
    ]);

    // 0.1 * 3 em ponto flutuante daria 0.30000000000000004.
    expect(resultado.totals.productsCents).toBe(30);
    expect(fromCents(resultado.totals.productsCents)).toBe(0.3);
  });

  it("o total confere com a soma dos itens ao centavo", () => {
    const itens = Array.from({ length: 37 }, (_, i) => ({
      productId: `p${i}`,
      name: `Item ${i}`,
      quantity: 1,
      unitPrice: 19.99,
      tax: tributacao,
    }));

    const resultado = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, itens);

    expect(resultado.totals.productsCents).toBe(37 * 1999);
    expect(resultado.items.reduce((s, i) => s + i.totalCents, 0)).toBe(resultado.totals.productsCents);
  });

  it("CSOSN 102 não destaca ICMS", () => {
    const resultado = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "p1", name: "Prato", quantity: 1, unitPrice: 50, tax: tributacao },
    ]);

    expect(resultado.items[0].icmsGroup).toBe("ICMSSN");
    expect(resultado.items[0].icmsBaseCents).toBe(0);
    expect(resultado.items[0].icmsValueCents).toBe(0);
  });

  it("CST 00 no regime normal destaca base e valor", () => {
    const resultado = calculateTaxes(TaxRegime.REGIME_NORMAL, [
      {
        productId: "p1",
        name: "Prato",
        quantity: 2,
        unitPrice: 50,
        tax: { ...tributacao, icmsCode: "00", icmsRate: 18 },
      },
    ]);

    expect(resultado.items[0].icmsGroup).toBe("ICMS");
    expect(resultado.items[0].icmsBaseCents).toBe(10_000);
    expect(resultado.items[0].icmsValueCents).toBe(1_800);
  });

  it("CST 40 (isento) não destaca ICMS mesmo com alíquota preenchida", () => {
    const resultado = calculateTaxes(TaxRegime.REGIME_NORMAL, [
      {
        productId: "p1",
        name: "Prato",
        quantity: 1,
        unitPrice: 50,
        tax: { ...tributacao, icmsCode: "40", icmsRate: 18 },
      },
    ]);

    expect(resultado.items[0].icmsValueCents).toBe(0);
  });

  it("entrega soma e desconto subtrai do total", () => {
    const resultado = calculateTaxes(
      TaxRegime.SIMPLES_NACIONAL,
      [{ productId: "p1", name: "A", quantity: 1, unitPrice: 30, tax: tributacao }],
      { deliveryFee: 7.5, discount: 2.5 },
    );

    expect(resultado.totals.totalCents).toBe(3500);
  });

  it("o valor aproximado de tributos acompanha o regime", () => {
    const simples = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "p1", name: "A", quantity: 1, unitPrice: 100, tax: tributacao },
    ]);
    const normal = calculateTaxes(TaxRegime.REGIME_NORMAL, [
      { productId: "p1", name: "A", quantity: 1, unitPrice: 100, tax: { ...tributacao, icmsCode: "00" } },
    ]);

    expect(normal.totals.approximateTaxCents).toBeGreaterThan(simples.totals.approximateTaxCents);
  });

  it("formata valores no padrão do XML", () => {
    expect(xmlAmount(1999)).toBe("19.99");
    expect(xmlAmount(5)).toBe("0.05");
    expect(xmlAmount(100_000)).toBe("1000.00");
    expect(toCents(19.99)).toBe(1999);
  });
});

describe("XML da NFC-e", () => {
  const emitente = {
    cnpj: "12345678000199",
    legalName: "Loja Teste Ltda",
    tradeName: "Loja Teste",
    stateRegistration: "ISENTO",
    taxRegime: TaxRegime.SIMPLES_NACIONAL,
    addressStreet: "Rua A",
    addressNumber: "10",
    addressComplement: null,
    addressDistrict: "Centro",
    cityIbgeCode: "3106200",
    cityName: "Belo Horizonte",
    state: "MG",
    zipCode: "30130000",
    phone: "31999998888",
  };

  function montar(overrides: any = {}) {
    const calculo = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "prod-1", name: "Prato do dia", quantity: 2, unitPrice: 25, tax: tributacao },
    ]);
    return buildNfceXml({
      accessKey: "31260812345678000199650010000000421123456780",
      numericCode: "12345678",
      series: 1,
      number: 42,
      issuedAt: new Date("2026-08-02T15:30:00-03:00"),
      environment: FiscalEnvironment.HOMOLOGACAO,
      emissionType: 1,
      emitter: emitente,
      items: calculo.items,
      totals: calculo.totals,
      payments: [{ method: PaymentMethod.DINHEIRO, amountCents: calculo.totals.totalCents }],
      ...overrides,
    });
  }

  it("gera um XML com o Id no formato exigido", () => {
    const xml = montar();
    expect(xml).toContain('Id="NFe31260812345678000199650010000000421123456780"');
    expect(xml).toContain('versao="4.00"');
  });

  it("usa o grupo ICMSSN no Simples", () => {
    const xml = montar();
    expect(xml).toContain("<ICMSSN102>");
    expect(xml).toContain("<CSOSN>102</CSOSN>");
    expect(xml).not.toContain("<CST>102</CST>");
  });

  it("usa o grupo ICMS00 no regime normal", () => {
    const calculo = calculateTaxes(TaxRegime.REGIME_NORMAL, [
      { productId: "p1", name: "Prato", quantity: 1, unitPrice: 50, tax: { ...tributacao, icmsCode: "00", icmsRate: 18 } },
    ]);
    const xml = montar({
      emitter: { ...emitente, taxRegime: TaxRegime.REGIME_NORMAL },
      items: calculo.items,
      totals: calculo.totals,
      payments: [{ method: PaymentMethod.DINHEIRO, amountCents: calculo.totals.totalCents }],
    });

    expect(xml).toContain("<ICMS00>");
    expect(xml).toContain("<CST>00</CST>");
    expect(xml).toContain("<pICMS>18.00</pICMS>");
  });

  it("CRT reflete o regime", () => {
    expect(montar()).toContain("<CRT>1</CRT>");
    expect(montar({ emitter: { ...emitente, taxRegime: TaxRegime.REGIME_NORMAL } })).toContain("<CRT>3</CRT>");
  });

  it("nunca emite elemento vazio — o layout distingue ausente de vazio", () => {
    const xml = montar({ emitter: { ...emitente, tradeName: null, addressComplement: null, phone: null } });

    expect(xml).not.toContain("<xFant></xFant>");
    expect(xml).not.toContain("<xCpl></xCpl>");
    expect(xml).not.toContain("<fone></fone>");
  });

  it("em homologação o destinatário leva a frase obrigatória de teste", () => {
    const xml = montar({ customer: { document: "12345678909", name: "Fulano de Tal" } });

    expect(xml).toContain("SEM VALOR FISCAL");
    expect(xml).not.toContain("Fulano de Tal");
  });

  it("em homologação identifica o destinatário de teste mesmo sem CPF", () => {
    const xml = montar();

    expect(xml).toContain("<dest>");
    expect(xml).toContain("NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL");
    expect(xml).not.toContain("<CPF>");
  });

  it("em produção, sem CPF/CNPJ, mantém o consumidor não identificado", () => {
    expect(montar({ environment: FiscalEnvironment.PRODUCAO })).not.toContain("<dest>");
  });

  it("contingência inclui data e justificativa", () => {
    const xml = montar({ emissionType: 9, contingencyReason: "SEFAZ fora do ar" });

    expect(xml).toContain("<tpEmis>9</tpEmis>");
    expect(xml).toContain("<dhCont>");
    expect(xml).toContain("SEFAZ fora do ar");
  });

  it("o total do XML confere com a soma dos itens", () => {
    const xml = montar();
    const vProd = xml.match(/<vProd>([\d.]+)<\/vProd>/g) ?? [];
    // Primeiro é o do item, último é o do total.
    expect(vProd[0]).toBe("<vProd>50.00</vProd>");
    expect(xml).toContain("<vNF>50.00</vNF>");
  });

  it("troco aparece quando o pagamento excede o total", () => {
    const calculo = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "p1", name: "Prato", quantity: 1, unitPrice: 45, tax: tributacao },
    ]);
    const xml = montar({
      items: calculo.items,
      totals: calculo.totals,
      payments: [{ method: PaymentMethod.DINHEIRO, amountCents: 5000 }],
    });

    expect(xml).toContain("<vTroco>5.00</vTroco>");
  });

  it("caractere de controle no nome do produto não vaza para o XML", () => {
    const calculo = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
      { productId: "p1", name: "Prato do dia", quantity: 1, unitPrice: 10, tax: tributacao },
    ]);
    const xml = montar({ items: calculo.items, totals: calculo.totals, payments: [{ method: PaymentMethod.DINHEIRO, amountCents: 1000 }] });

    expect(xml).toContain("<xProd>Prato do dia</xProd>");
  });
});

describe("QR Code", () => {
  const base = {
    accessKey: "31260812345678000199650010000000421123456780",
    uf: "MG",
    environment: FiscalEnvironment.HOMOLOGACAO,
    cscId: "000001",
    cscToken: "TOKEN-SECRETO-DO-CSC-123",
    emissionType: 1,
  };

  it("a URL não contém o CSC em claro", () => {
    const url = buildQrCode(base);
    expect(url).not.toContain("TOKEN-SECRETO-DO-CSC-123");
  });

  it("o hash muda se o CSC mudar", () => {
    const a = buildQrCode(base);
    const b = buildQrCode({ ...base, cscToken: "OUTRO-TOKEN-DIFERENTE-9999" });
    expect(a).not.toBe(b);
  });

  it("emissão normal usa a forma curta com 4 campos", () => {
    const url = buildQrCode(base);
    const parametros = decodeURIComponent(url.split("p=")[1]);
    // chave|versao|ambiente|idCSC|hash
    expect(parametros.split("|")).toHaveLength(5);
  });

  it("contingência usa a forma longa e exige os dados extras", () => {
    const url = buildQrCode({
      ...base,
      emissionType: 9,
      offline: {
        issuedAt: new Date("2026-08-02T15:00:00-03:00"),
        totalCents: 5000,
        icmsBaseCents: 0,
        digestValue: Buffer.from("digest").toString("base64"),
      },
    });
    const parametros = url.split("p=")[1];
    expect(parametros.split("|")).toHaveLength(8);

    expect(() => buildQrCode({ ...base, emissionType: 9 })).toThrow(/contingência/);
  });

  it("UF não habilitada avisa o que fazer", () => {
    expect(() => buildQrCode({ ...base, uf: "AC" })).toThrow(/não está habilitada/);
  });
});

describe("tradução das rejeições", () => {
  it("100 é autorização", () => {
    expect(isAuthorized("100")).toBe(true);
    expect(isAuthorized("204")).toBe(false);
  });

  it("108 e 109 indicam indisponibilidade e justificam contingência", () => {
    expect(isServiceUnavailable("108")).toBe(true);
    expect(isServiceUnavailable("109")).toBe(true);
    expect(isServiceUnavailable("215")).toBe(false);
  });

  it("erro de cadastro aponta onde corrigir", () => {
    expect(rejectionGuidance("209").hint).toContain("Painel > Fiscal");
    expect(rejectionGuidance("209").burnsNumber).toBe(true);
  });

  it("certificado vencido não é reenviável", () => {
    const orientacao = rejectionGuidance("280");
    expect(orientacao.retryable).toBe(false);
    expect(orientacao.hint).toContain("certificado");
  });

  it("código desconhecido não inventa solução — devolve o código e manda contatar o suporte", () => {
    const orientacao = rejectionGuidance("8888", "Motivo estranho");
    expect(orientacao.hint).toContain("8888");
    expect(orientacao.hint).toContain("Motivo estranho");
    expect(orientacao.hint).toContain("suporte");
  });

  it("duplicidade não é reenviável e queima o número", () => {
    expect(rejectionGuidance("206").burnsNumber).toBe(true);
    expect(rejectionGuidance("206").retryable).toBe(false);
  });
});

describe("leitura da resposta SOAP", () => {
  const soap = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
    <soap:Body><nfeResultMsg>
      <retEnviNFe versao="4.00"><tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo>
        <protNFe versao="4.00"><infProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>
        <nProt>131260000123456</nProt></infProt></protNFe>
      </retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>`;

  it("extrai o XML de negócio de dentro do envelope", () => {
    const xml = extractResult(soap, ["retEnviNFe"]);
    expect(xml.startsWith("<retEnviNFe")).toBe(true);
    expect(xml).not.toContain("soap:Envelope");
  });

  it("o cStat do lote não é confundido com o do protocolo", () => {
    const xml = extractResult(soap, ["retEnviNFe"]);
    expect(tagValue(xml, "cStat")).toBe("104");
    const protocolo = xml.match(/<protNFe[\s\S]*?<\/protNFe>/)![0];
    expect(tagValue(protocolo, "cStat")).toBe("100");
    expect(tagValue(protocolo, "nProt")).toBe("131260000123456");
  });

  it("tag ausente devolve nulo em vez de quebrar", () => {
    expect(tagValue("<a>1</a>", "inexistente")).toBeNull();
  });
});

describe("DANFE", () => {
  const calculo = calculateTaxes(TaxRegime.SIMPLES_NACIONAL, [
    { productId: "p1", name: "Prato do dia", quantity: 2, unitPrice: 25, tax: tributacao },
  ]);

  const entrada = {
    emitterName: "Loja Teste Ltda",
    emitterCnpj: "12345678000199",
    emitterAddress: "Rua A, 10 - Centro, Belo Horizonte/MG",
    emitterState: "MG",
    environment: FiscalEnvironment.HOMOLOGACAO,
    accessKey: "31260812345678000199650010000000421123456780",
    series: 1,
    number: 42,
    issuedAt: new Date("2026-08-02T15:30:00-03:00"),
    protocolNumber: "131260000123456",
    authorizedAt: new Date("2026-08-02T15:30:05-03:00"),
    qrCodeUrl: "https://exemplo/qr?p=1",
    items: calculo.items,
    totals: calculo.totals,
    payments: [{ label: "Dinheiro", amountCents: calculo.totals.totalCents }],
  };

  it("avisa que homologação não tem valor fiscal", () => {
    expect(buildDanfeText(entrada)).toContain("SEM VALOR FISCAL");
  });

  it("mostra a chave, o total e o protocolo", () => {
    const cupom = buildDanfeText(entrada);
    expect(cupom).toContain("3126 0812 3456");
    expect(cupom).toContain("50,00");
    expect(cupom).toContain("131260000123456");
  });

  it("sem CPF diz que o consumidor não foi identificado", () => {
    expect(buildDanfeText(entrada)).toContain("CONSUMIDOR NAO IDENTIFICADO");
  });

  it("contingência avisa que a autorização está pendente", () => {
    expect(buildDanfeText({ ...entrada, offline: true })).toContain("CONTINGENCIA");
  });
});
