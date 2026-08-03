import { TaxOrigin, TaxRegime } from "@prisma/client";
import { resolveProductTax } from "../src/fiscal/product-tax";

/**
 * A tributação do item nasce do padrão da empresa e é sobrescrita pelo produto.
 * O erro que este arquivo protege é o silencioso: cadastro pela metade que só
 * aparece quando a SEFAZ rejeita a nota, com o cliente esperando no balcão.
 */
describe("resolução da tributação do produto", () => {
  const perfilSimples = {
    taxRegime: TaxRegime.SIMPLES_NACIONAL,
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

  const produtoVazio = {
    name: "Prato do dia",
    ncm: null,
    cest: null,
    cfop: null,
    taxOrigin: null,
    icmsCode: null,
    icmsRate: null,
    pisCode: null,
    pisRate: null,
    cofinsCode: null,
    cofinsRate: null,
    unit: null,
  };

  it("produto sem nada herda tudo da empresa", () => {
    const resultado = resolveProductTax(perfilSimples, produtoVazio);

    expect(resultado.pendencias).toEqual([]);
    expect(resultado.tax).toMatchObject({
      ncm: "21069090",
      cfop: "5102",
      icmsCode: "102",
      pisCode: "49",
      unit: "UN",
    });
    expect(resultado.herdados).toEqual(
      expect.arrayContaining(["ncm", "cfop", "icmsCode", "pisCode", "unit"]),
    );
  });

  it("o produto sobrescreve o padrão sem afetar os demais campos", () => {
    const resultado = resolveProductTax(perfilSimples, {
      ...produtoVazio,
      name: "Cerveja",
      ncm: "22030000",
      unit: "UN",
    });

    expect(resultado.tax?.ncm).toBe("22030000");
    expect(resultado.tax?.cfop).toBe("5102");
    expect(resultado.herdados).not.toContain("ncm");
    expect(resultado.herdados).toContain("cfop");
  });

  it("zero no produto é valor, não ausência", () => {
    const resultado = resolveProductTax(
      { ...perfilSimples, defaultIcmsRate: 18 },
      { ...produtoVazio, icmsRate: 0 },
    );

    expect(resultado.tax?.icmsRate).toBe(0);
    expect(resultado.herdados).not.toContain("icmsRate");
  });

  it("lista todas as pendências de uma vez, não só a primeira", () => {
    const resultado = resolveProductTax(
      { ...perfilSimples, defaultNcm: null, defaultIcmsCode: null, defaultPisCode: null },
      produtoVazio,
    );

    expect(resultado.tax).toBeNull();
    expect(resultado.pendencias).toEqual(
      expect.arrayContaining([
        "NCM não informado.",
        "CSOSN não informado.",
        "CST de PIS não informado.",
      ]),
    );
  });

  describe("coerência entre código de ICMS e regime", () => {
    it("CST em empresa do Simples é recusado com a explicação certa", () => {
      const resultado = resolveProductTax(perfilSimples, { ...produtoVazio, icmsCode: "00" });

      expect(resultado.tax).toBeNull();
      expect(resultado.pendencias.join(" ")).toContain("no Simples Nacional use CSOSN");
    });

    it("CSOSN em empresa de regime normal é recusado", () => {
      const resultado = resolveProductTax(
        { ...perfilSimples, taxRegime: TaxRegime.REGIME_NORMAL, defaultIcmsCode: null },
        { ...produtoVazio, icmsCode: "102" },
      );

      expect(resultado.tax).toBeNull();
      expect(resultado.pendencias.join(" ")).toContain("no regime normal use CST");
    });

    it("CST válido em regime normal passa", () => {
      const resultado = resolveProductTax(
        { ...perfilSimples, taxRegime: TaxRegime.REGIME_NORMAL, defaultIcmsCode: "00", defaultIcmsRate: 18 },
        produtoVazio,
      );

      expect(resultado.pendencias).toEqual([]);
      expect(resultado.tax?.icmsCode).toBe("00");
      expect(resultado.tax?.icmsRate).toBe(18);
    });

    it("Simples com excesso de sublimite continua usando CSOSN", () => {
      const resultado = resolveProductTax(
        { ...perfilSimples, taxRegime: TaxRegime.SIMPLES_NACIONAL_EXCESSO },
        produtoVazio,
      );

      expect(resultado.pendencias).toEqual([]);
    });
  });

  describe("validação de formato", () => {
    it("NCM com menos de 8 dígitos é recusado", () => {
      const resultado = resolveProductTax(perfilSimples, { ...produtoVazio, ncm: "2106" });
      expect(resultado.pendencias).toContain("NCM deve ter 8 dígitos.");
    });

    it("CFOP fora da lista de venda ao consumidor é recusado", () => {
      const resultado = resolveProductTax(perfilSimples, { ...produtoVazio, cfop: "6102" });
      expect(resultado.pendencias.join(" ")).toContain("não é válido para venda ao consumidor");
    });

    it("alíquota fora de 0–100 é recusada", () => {
      const resultado = resolveProductTax(perfilSimples, { ...produtoVazio, icmsRate: 150 });
      expect(resultado.pendencias.join(" ")).toContain("entre 0 e 100");
    });

    it("unidade desconhecida é recusada", () => {
      const resultado = resolveProductTax(perfilSimples, { ...produtoVazio, unit: "XYZ" });
      expect(resultado.pendencias.join(" ")).toContain("não é reconhecida");
    });

    it("CEST é opcional, mas se vier tem formato fixo", () => {
      expect(resolveProductTax(perfilSimples, { ...produtoVazio, cest: "123" }).pendencias)
        .toContain("CEST deve ter 7 dígitos.");
      expect(resolveProductTax(perfilSimples, { ...produtoVazio, cest: "0300100" }).pendencias)
        .toEqual([]);
    });
  });

  it("alíquota ausente vale zero — CSOSN 102 não tem alíquota própria", () => {
    const resultado = resolveProductTax(perfilSimples, produtoVazio);
    expect(resultado.tax?.icmsRate).toBe(0);
  });

  it("Decimal do Prisma chega como objeto e é convertido", () => {
    const decimalFalso = { toString: () => "18.00" };
    const resultado = resolveProductTax(
      { ...perfilSimples, taxRegime: TaxRegime.REGIME_NORMAL, defaultIcmsCode: "00" },
      { ...produtoVazio, icmsRate: decimalFalso },
    );

    expect(resultado.tax?.icmsRate).toBe(18);
  });

  it("sem cadastro fiscal da empresa nada é emissível", () => {
    const resultado = resolveProductTax(null, produtoVazio);

    expect(resultado.tax).toBeNull();
    expect(resultado.pendencias).toEqual(["Cadastro fiscal da empresa não preenchido."]);
  });
});
