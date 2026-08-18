import { create } from "xmlbuilder2";
import { FiscalEnvironment, PaymentMethod, TaxRegime } from "@prisma/client";
import { TAX_ORIGIN_CODE, TaxOrigin as SharedTaxOrigin } from "@chegowia/shared";
import { CalculatedItem, CalculatedTotals, xmlAmount, xmlQuantity, xmlRate, xmlUnitPrice } from "./tax-engine";
import { UF_CODES } from "./access-key";

/**
 * Monta o XML da NFC-e no layout 4.00.
 *
 * O que é fácil errar aqui e custa caro:
 *
 * - **Ordem dos elementos importa.** O XSD da SEFAZ é `sequence`, não `all`.
 *   Um campo no lugar errado é rejeição de schema, com mensagem críptica.
 * - **Campo vazio não pode existir.** O layout distingue "ausente" de "vazio";
 *   `<xNome></xNome>` é rejeitado. Por isso `opcional()` omite em vez de
 *   escrever string vazia.
 * - **Homologação tem duas frases obrigatórias.** A descrição do primeiro item
 *   precisa ser exatamente a frase de teste (rejeição 373) e, se houver
 *   destinatário, o nome dele também (rejeição 598). Emitir com o nome real do
 *   produto em homologação é rejeição garantida — e homologação é justamente
 *   onde o lojista testa antes de valer.
 *
 * - **O destinatário só existe com CPF ou CNPJ.** O grupo `dest` sem documento
 *   é inválido no schema: se o consumidor não se identificou, o grupo inteiro
 *   fica de fora, em produção e em homologação.
 */

export interface NfceEmitter {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  stateRegistration: string;
  taxRegime: TaxRegime;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string | null;
  addressDistrict: string;
  cityIbgeCode: string;
  cityName: string;
  state: string;
  zipCode: string;
  phone: string | null;
}

export interface NfceCustomer {
  /** CPF ou CNPJ, só dígitos. Ausente = consumidor não identificado. */
  document?: string | null;
  name?: string | null;
}

export interface NfcePayment {
  method: PaymentMethod;
  amountCents: number;
}

export interface NfceInput {
  accessKey: string;
  numericCode: string;
  series: number;
  number: number;
  issuedAt: Date;
  environment: FiscalEnvironment;
  /** 1 normal, 9 contingência offline. */
  emissionType: number;
  contingencyReason?: string;
  emitter: NfceEmitter;
  customer?: NfceCustomer;
  items: CalculatedItem[];
  totals: CalculatedTotals;
  payments: NfcePayment[];
  additionalInfo?: string;
}

/** tPag do layout 4.00. */
const PAYMENT_CODE: Record<PaymentMethod, string> = {
  [PaymentMethod.DINHEIRO]: "01",
  [PaymentMethod.CARTAO_ENTREGA]: "03",
  [PaymentMethod.PIX_MANUAL]: "17",
};

/** Frase obrigatória no destinatário em homologação (rejeição 598). */
const HOMOLOGACAO_NAME = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/** Frase obrigatória na descrição do primeiro item em homologação (rejeição 373). */
const HOMOLOGACAO_PRODUCT = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

export function buildNfceXml(input: NfceInput): string {
  const { emitter, totals } = input;
  const cUF = UF_CODES[emitter.state.toUpperCase()];
  if (!cUF) throw new Error(`UF sem código IBGE conhecido: ${emitter.state}`);
  const tpAmb = input.environment === FiscalEnvironment.PRODUCAO ? "1" : "2";

  const doc = create({ version: "1.0", encoding: "UTF-8" });
  const nfe = doc.ele("NFe", { xmlns: "http://www.portalfiscal.inf.br/nfe" });
  const infNFe = nfe.ele("infNFe", { versao: "4.00", Id: `NFe${input.accessKey}` });

  // ---- ide ----
  const ide = infNFe.ele("ide");
  ide.ele("cUF").txt(cUF);
  ide.ele("cNF").txt(input.numericCode.padStart(8, "0"));
  ide.ele("natOp").txt("VENDA AO CONSUMIDOR");
  ide.ele("mod").txt("65");
  ide.ele("serie").txt(String(input.series));
  ide.ele("nNF").txt(String(input.number));
  ide.ele("dhEmi").txt(toXmlDate(input.issuedAt));
  ide.ele("tpNF").txt("1"); // saída
  ide.ele("idDest").txt("1"); // operação interna
  ide.ele("cMunFG").txt(emitter.cityIbgeCode);
  ide.ele("tpImp").txt("4"); // DANFE NFC-e
  ide.ele("tpEmis").txt(String(input.emissionType));
  ide.ele("cDV").txt(input.accessKey.slice(-1));
  ide.ele("tpAmb").txt(tpAmb);
  ide.ele("finNFe").txt("1"); // normal
  ide.ele("indFinal").txt("1"); // consumidor final
  ide.ele("indPres").txt("1"); // operação presencial
  ide.ele("procEmi").txt("0");
  ide.ele("verProc").txt("ChegowIA 1.0");
  if (input.emissionType === 9) {
    // Na contingência a SEFAZ exige quando e por quê — sem isso o documento é
    // rejeitado ao ser transmitido depois.
    ide.ele("dhCont").txt(toXmlDate(input.issuedAt));
    ide.ele("xJust").txt(input.contingencyReason ?? "Falha de comunicacao com a SEFAZ");
  }

  // ---- emit ----
  const emit = infNFe.ele("emit");
  emit.ele("CNPJ").txt(digits(emitter.cnpj));
  emit.ele("xNome").txt(cut(emitter.legalName, 60));
  opcional(emit, "xFant", emitter.tradeName && cut(emitter.tradeName, 60));
  const enderEmit = emit.ele("enderEmit");
  enderEmit.ele("xLgr").txt(cut(emitter.addressStreet, 60));
  enderEmit.ele("nro").txt(cut(emitter.addressNumber, 60));
  opcional(enderEmit, "xCpl", emitter.addressComplement && cut(emitter.addressComplement, 60));
  enderEmit.ele("xBairro").txt(cut(emitter.addressDistrict, 60));
  enderEmit.ele("cMun").txt(emitter.cityIbgeCode);
  enderEmit.ele("xMun").txt(cut(emitter.cityName, 60));
  enderEmit.ele("UF").txt(emitter.state.toUpperCase());
  enderEmit.ele("CEP").txt(digits(emitter.zipCode));
  enderEmit.ele("cPais").txt("1058");
  enderEmit.ele("xPais").txt("BRASIL");
  opcional(enderEmit, "fone", emitter.phone && digits(emitter.phone).slice(0, 14));
  emit.ele("IE").txt(emitter.stateRegistration.toUpperCase() === "ISENTO" ? "ISENTO" : digits(emitter.stateRegistration));
  emit.ele("CRT").txt(crtCode(emitter.taxRegime));

  // ---- dest ----
  // Na NFC-e o destinatário é opcional e só entra quando o cliente pede
  // CPF/CNPJ — o grupo sem documento nenhum é recusado pelo schema. Quando
  // existe e o ambiente é de homologação, o nome tem que ser a frase de teste.
  const documento = digits(input.customer?.document ?? "");
  if (documento) {
    const dest = infNFe.ele("dest");
    if (documento.length === 14) dest.ele("CNPJ").txt(documento);
    else dest.ele("CPF").txt(documento.padStart(11, "0"));
    const nome = input.environment === FiscalEnvironment.PRODUCAO
      ? input.customer?.name
      : HOMOLOGACAO_NAME;
    opcional(dest, "xNome", nome && cut(nome, 60));
    dest.ele("indIEDest").txt("9"); // não contribuinte
  }

  // ---- det ----
  input.items.forEach((item, index) => {
    const det = infNFe.ele("det", { nItem: String(index + 1) });
    const prod = det.ele("prod");
    prod.ele("cProd").txt(item.productId.slice(0, 60));
    prod.ele("cEAN").txt("SEM GTIN");
    prod.ele("xProd").txt(
      // Em homologação a SEFAZ confere a descrição do primeiro item contra a
      // frase literal de teste; qualquer outra coisa é rejeição 373.
      index === 0 && input.environment !== FiscalEnvironment.PRODUCAO
        ? HOMOLOGACAO_PRODUCT
        : cut(sanitize(item.name), 120),
    );
    prod.ele("NCM").txt(item.tax.ncm);
    opcional(prod, "CEST", item.tax.cest);
    prod.ele("CFOP").txt(item.tax.cfop);
    prod.ele("uCom").txt(item.tax.unit);
    prod.ele("qCom").txt(xmlQuantity(item.quantity));
    prod.ele("vUnCom").txt(xmlUnitPrice(item.unitPriceCents));
    prod.ele("vProd").txt(xmlAmount(item.totalCents));
    prod.ele("cEANTrib").txt("SEM GTIN");
    prod.ele("uTrib").txt(item.tax.unit);
    prod.ele("qTrib").txt(xmlQuantity(item.quantity));
    prod.ele("vUnTrib").txt(xmlUnitPrice(item.unitPriceCents));
    // A SEFAZ refaz a soma do frete e do desconto a partir dos itens; declarar
    // só no total é rejeição 535/536.
    if (item.freightCents > 0) prod.ele("vFrete").txt(xmlAmount(item.freightCents));
    if (item.discountCents > 0) prod.ele("vDesc").txt(xmlAmount(item.discountCents));
    prod.ele("indTot").txt("1");

    const imposto = det.ele("imposto");
    imposto.ele("vTotTrib").txt(
      xmlAmount(Math.round((totals.approximateTaxCents * item.totalCents) / Math.max(1, totals.productsCents))),
    );
    buildIcms(imposto, item);
    buildPisCofins(imposto, item);
  });

  // ---- total ----
  const total = infNFe.ele("total").ele("ICMSTot");
  total.ele("vBC").txt(xmlAmount(totals.icmsBaseCents));
  total.ele("vICMS").txt(xmlAmount(totals.icmsValueCents));
  total.ele("vICMSDeson").txt("0.00");
  total.ele("vFCP").txt("0.00");
  total.ele("vBCST").txt("0.00");
  total.ele("vST").txt("0.00");
  total.ele("vFCPST").txt("0.00");
  total.ele("vFCPSTRet").txt("0.00");
  total.ele("vProd").txt(xmlAmount(totals.productsCents));
  total.ele("vFrete").txt(xmlAmount(totals.deliveryCents));
  total.ele("vSeg").txt("0.00");
  total.ele("vDesc").txt(xmlAmount(totals.discountCents));
  total.ele("vII").txt("0.00");
  total.ele("vIPI").txt("0.00");
  total.ele("vIPIDevol").txt("0.00");
  total.ele("vPIS").txt(xmlAmount(totals.pisValueCents));
  total.ele("vCOFINS").txt(xmlAmount(totals.cofinsValueCents));
  total.ele("vOutro").txt("0.00");
  total.ele("vNF").txt(xmlAmount(totals.totalCents));
  total.ele("vTotTrib").txt(xmlAmount(totals.approximateTaxCents));

  // ---- transp ----
  infNFe.ele("transp").ele("modFrete").txt("9"); // sem transporte

  // ---- pag ----
  const pag = infNFe.ele("pag");
  for (const payment of input.payments) {
    const tPag = PAYMENT_CODE[payment.method] ?? "99";
    const detPag = pag.ele("detPag");
    detPag.ele("indPag").txt("0"); // à vista
    detPag.ele("tPag").txt(tPag);
    detPag.ele("vPag").txt(xmlAmount(payment.amountCents));
    if (tPag === "03" || tPag === "04") {
      // Pagamento em cartão sem o grupo de cartões é rejeição 391 nas UFs que
      // aplicam a regra. `tpIntegra=2` é a verdade aqui: a maquininha do
      // restaurante não é integrada ao sistema, o valor é digitado no caixa.
      detPag.ele("card").ele("tpIntegra").txt("2");
    }
  }
  const pago = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  // Troco só faz sentido — e só é aceito — quando houve dinheiro em espécie.
  const houveDinheiro = input.payments.some((payment) => PAYMENT_CODE[payment.method] === "01");
  if (pago > totals.totalCents && houveDinheiro) {
    pag.ele("vTroco").txt(xmlAmount(pago - totals.totalCents));
  }

  // ---- infAdic ----
  if (input.additionalInfo) {
    infNFe.ele("infAdic").ele("infCpl").txt(cut(sanitize(input.additionalInfo), 5000));
  }

  return doc.end({ prettyPrint: false, headless: false });
}

function buildIcms(imposto: ReturnType<typeof create>, item: CalculatedItem) {
  const icms = imposto.ele("ICMS");
  const orig = TAX_ORIGIN_CODE[item.tax.taxOrigin as unknown as SharedTaxOrigin] ?? "0";

  if (item.icmsGroup === "ICMSSN") {
    // No Simples o grupo é ICMSSN<CSOSN> e não há valor destacado, salvo no
    // 900 (outros), que aceita base e alíquota.
    const csosn = item.tax.icmsCode;
    const grupo = icms.ele(`ICMSSN${csosnGroup(csosn)}`);
    grupo.ele("orig").txt(orig);
    grupo.ele("CSOSN").txt(csosn);
    if (csosn === "101") {
      // Crédito do adquirente, não imposto destacado: vive só aqui e fica fora
      // do total da nota.
      grupo.ele("pCredSN").txt(xmlRate(item.tax.icmsRate));
      grupo.ele("vCredICMSSN").txt(xmlAmount(item.snCreditCents));
    }
    if (csosn === "900") {
      grupo.ele("modBC").txt("3");
      grupo.ele("vBC").txt(xmlAmount(item.icmsBaseCents));
      grupo.ele("pICMS").txt(xmlRate(item.tax.icmsRate));
      grupo.ele("vICMS").txt(xmlAmount(item.icmsValueCents));
    }
    return;
  }

  const cst = item.tax.icmsCode;
  const grupo = icms.ele(`ICMS${cstGroup(cst)}`);
  grupo.ele("orig").txt(orig);
  grupo.ele("CST").txt(cst);
  if (cst === "00" || cst === "20" || cst === "90") {
    grupo.ele("modBC").txt("3"); // valor da operação
    // No CST 20 o percentual de redução vem antes da base e é obrigatório: é
    // ele que explica por que a base é menor que o valor da operação.
    if (cst === "20") grupo.ele("pRedBC").txt(xmlRate(item.tax.icmsReductionRate ?? 0));
    grupo.ele("vBC").txt(xmlAmount(item.icmsBaseCents));
    grupo.ele("pICMS").txt(xmlRate(item.tax.icmsRate));
    grupo.ele("vICMS").txt(xmlAmount(item.icmsValueCents));
  }
}

/**
 * CST de PIS/COFINS que vão no grupo "não tributada": o schema aceita só o
 * CST nesses casos e recusa base e alíquota, mesmo zeradas.
 */
const CST_NAO_TRIBUTADA = new Set(["04", "05", "06", "07", "08", "09"]);

/** CST com alíquota própria — grupo `Aliq`. Os demais caem em `Outr`. */
const CST_ALIQUOTA = new Set(["01", "02"]);

function buildPisCofins(imposto: ReturnType<typeof create>, item: CalculatedItem) {
  buildContribuicao(imposto.ele("PIS"), "PIS", item.tax.pisCode, {
    baseCents: item.pisBaseCents,
    rate: item.tax.pisRate,
    valueCents: item.pisValueCents,
  });
  buildContribuicao(imposto.ele("COFINS"), "COFINS", item.tax.cofinsCode, {
    baseCents: item.cofinsBaseCents,
    rate: item.tax.cofinsRate,
    valueCents: item.cofinsValueCents,
  });
}

function buildContribuicao(
  parent: ReturnType<typeof create>,
  tributo: "PIS" | "COFINS",
  cst: string,
  valores: { baseCents: number; rate: number; valueCents: number },
) {
  if (CST_NAO_TRIBUTADA.has(cst)) {
    parent.ele(`${tributo}NT`).ele("CST").txt(cst);
    return;
  }

  // `Outr` cobre CST 49 e os demais sem alíquota própria — é o grupo usado
  // pela maioria dos restaurantes do Simples.
  const grupo = parent.ele(`${tributo}${CST_ALIQUOTA.has(cst) ? "Aliq" : "Outr"}`);
  grupo.ele("CST").txt(cst);
  grupo.ele("vBC").txt(xmlAmount(valores.baseCents));
  grupo.ele(tributo === "PIS" ? "pPIS" : "pCOFINS").txt(xmlRate(valores.rate));
  grupo.ele(tributo === "PIS" ? "vPIS" : "vCOFINS").txt(xmlAmount(valores.valueCents));
}

/** O nome do grupo XML não é o CSOSN inteiro: 101→101, 102/103/300/400→102... */
function csosnGroup(csosn: string) {
  if (csosn === "101") return "101";
  if (["102", "103", "300", "400"].includes(csosn)) return "102";
  if (csosn === "500") return "500";
  if (csosn === "900") return "900";
  return "102";
}

function cstGroup(cst: string) {
  if (["40", "41", "50"].includes(cst)) return "40";
  if (cst === "60") return "60";
  if (cst === "20") return "20";
  if (cst === "90") return "90";
  return "00";
}

function crtCode(regime: TaxRegime) {
  if (regime === TaxRegime.SIMPLES_NACIONAL) return "1";
  if (regime === TaxRegime.SIMPLES_NACIONAL_EXCESSO) return "2";
  return "3";
}

/** Data no formato do layout: ISO local com offset (não UTC). */
export function toXmlDate(date: Date, timeZoneOffsetHours = -3) {
  const local = new Date(date.getTime() + timeZoneOffsetHours * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const sinal = timeZoneOffsetHours <= 0 ? "-" : "+";
  const offset = `${sinal}${pad(Math.abs(timeZoneOffsetHours))}:00`;
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

function opcional(parent: any, tag: string, value: string | null | undefined) {
  // O layout distingue ausente de vazio: `<xFant></xFant>` é rejeitado.
  if (value === null || value === undefined || value === "") return;
  parent.ele(tag).txt(value);
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function cut(value: string, max: number) {
  return value.slice(0, max);
}

/**
 * O XML da SEFAZ recusa caracteres de controle e trata acento por codificação.
 * Nome de produto vem de campo livre do lojista, então passa por aqui.
 */
function sanitize(value: string) {
  // Caracteres de controle são recusados pelo XML da SEFAZ. O `split`/`filter`
  // por código evita a regex de intervalo de controle, que o lint bloqueia com
  // razão — a intenção fica explícita no lugar de escondida num escape.
  return Array.from(value)
    .map((char) => {
      const codigo = char.codePointAt(0) ?? 0;
      return codigo < 0x20 || codigo === 0x7f ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
