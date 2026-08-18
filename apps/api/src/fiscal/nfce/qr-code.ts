import { createHash } from "node:crypto";
import { FiscalEnvironment } from "@prisma/client";

/**
 * QR Code da NFC-e (versão 2 do manual).
 *
 * É o que o consumidor lê no cupom para conferir a nota no site da SEFAZ. O
 * conteúdo é uma URL com parâmetros e uma assinatura: o CSC (Código de
 * Segurança do Contribuinte) é concatenado aos parâmetros e o SHA-1 do
 * resultado vira `cHashQRCode`.
 *
 * O CSC nunca entra na URL — só o hash. Por isso ele é guardado cifrado e só
 * é decifrado aqui, no momento da montagem.
 */

/** URL de consulta do QR Code por UF e ambiente. */
const QR_URLS: Record<string, { homologacao: string; producao: string }> = {
  AC: {
    homologacao: "http://www.hml.sefaznet.ac.gov.br/nfce/qrcode",
    producao: "http://www.sefaznet.ac.gov.br/nfce/qrcode",
  },
  AL: {
    homologacao: "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
    producao: "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
  },
  AM: {
    homologacao: "https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp",
    producao: "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp",
  },
  AP: {
    homologacao: "https://www.sefaz.ap.gov.br/nfcehml/nfce.php",
    producao: "https://www.sefaz.ap.gov.br/nfce/nfcep.php",
  },
  BA: {
    homologacao: "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
    producao: "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
  },
  CE: {
    homologacao: "http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html",
    producao: "http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
  },
  DF: {
    homologacao: "http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx",
    producao: "http://www.fazenda.df.gov.br/nfce/qrcode",
  },
  ES: {
    homologacao: "http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
    producao: "http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
  },
  GO: {
    homologacao: "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
    producao: "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
  },
  MA: {
    homologacao: "http://www.hom.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
    producao: "http://www.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
  },
  MG: {
    homologacao: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
    producao: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
  },
  MS: {
    homologacao: "http://www.dfe.ms.gov.br/nfce/qrcode",
    producao: "http://www.dfe.ms.gov.br/nfce/qrcode",
  },
  MT: {
    homologacao: "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce",
    producao: "http://www.sefaz.mt.gov.br/nfce/consultanfce",
  },
  PA: {
    homologacao: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
    producao: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
  },
  PB: {
    homologacao: "http://www.sefaz.pb.gov.br/nfcehom",
    producao: "http://www.sefaz.pb.gov.br/nfce",
  },
  PE: {
    homologacao: "http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta",
    producao: "http://nfce.sefaz.pe.gov.br/nfce/consulta",
  },
  PI: {
    homologacao: "http://www.sefaz.pi.gov.br/nfce/qrcode",
    producao: "http://www.sefaz.pi.gov.br/nfce/qrcode",
  },
  PR: {
    homologacao: "http://www.fazenda.pr.gov.br/nfce/qrcode",
    producao: "http://www.fazenda.pr.gov.br/nfce/qrcode",
  },
  RJ: {
    homologacao: "http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode",
    producao: "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
  },
  RN: {
    homologacao: "http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx",
    producao: "http://nfce.set.rn.gov.br/consultarNFCe.aspx",
  },
  RO: {
    homologacao: "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
    producao: "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
  },
  RR: {
    homologacao: "http://200.174.88.103:8080/nfce/servlet/qrcode",
    producao: "https://www.sefaz.rr.gov.br/servlet/qrcode",
  },
  RS: {
    homologacao: "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
    producao: "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
  },
  SC: {
    homologacao: "https://hom.sat.sef.sc.gov.br/nfce/consulta",
    producao: "https://sat.sef.sc.gov.br/nfce/consulta",
  },
  SE: {
    homologacao: "http://www.hom.nfe.se.gov.br/nfce/qrcode",
    producao: "http://www.nfce.se.gov.br/nfce/qrcode",
  },
  SP: {
    homologacao: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
    producao: "https://www.nfce.fazenda.sp.gov.br/qrcode",
  },
  TO: {
    homologacao: "http://homologacao.sefaz.to.gov.br/nfce/qrcode",
    producao: "http://www.sefaz.to.gov.br/nfce/qrcode",
  },
};

/** URL "Consulta por chave de acesso" impressa no DANFE, ao lado do QR. */
const CONSULTA_URLS: Record<string, { homologacao: string; producao: string }> = {
  MG: {
    homologacao: "https://hnfce.fazenda.mg.gov.br/portalnfce",
    producao: "https://nfce.fazenda.mg.gov.br/portalnfce",
  },
  SP: {
    homologacao: "https://www.homologacao.nfce.fazenda.sp.gov.br/consulta",
    producao: "https://www.nfce.fazenda.sp.gov.br/consulta",
  },
};

export function qrCodeBaseUrl(uf: string, environment: FiscalEnvironment) {
  const entry = QR_URLS[uf.toUpperCase()];
  if (!entry) {
    throw new Error(
      `A UF ${uf} ainda não está habilitada para NFC-e nesta instalação. `
      + "Cadastre a URL do QR Code do estado antes de emitir.",
    );
  }
  return environment === FiscalEnvironment.PRODUCAO ? entry.producao : entry.homologacao;
}

export function consultaUrl(uf: string, environment: FiscalEnvironment) {
  const entry = CONSULTA_URLS[uf.toUpperCase()] ?? QR_URLS[uf.toUpperCase()];
  if (!entry) return "";
  return environment === FiscalEnvironment.PRODUCAO ? entry.producao : entry.homologacao;
}

export interface QrCodeInput {
  accessKey: string;
  uf: string;
  environment: FiscalEnvironment;
  cscId: string;
  cscToken: string;
  /** Emissão normal (1) usa a forma curta; contingência (9) a longa. */
  emissionType: number;
  /** Só na contingência: data de emissão, total e digest da assinatura. */
  offline?: {
    issuedAt: Date;
    totalCents: number;
    icmsBaseCents: number;
    digestValue: string;
  };
}

/**
 * Monta a URL do QR Code.
 *
 * Na emissão normal a nota já está autorizada quando o cupom é impresso, então
 * a SEFAZ consegue resolver tudo pela chave: bastam chave, versão, ambiente e
 * identificador do CSC. Na contingência offline não há autorização ainda, e o
 * QR precisa carregar data, valores e o digest da assinatura para que a
 * consulta funcione antes da transmissão.
 */
export function buildQrCode(input: QrCodeInput): string {
  const base = qrCodeBaseUrl(input.uf, input.environment);
  const tpAmb = input.environment === FiscalEnvironment.PRODUCAO ? "1" : "2";
  const idToken = String(Number(input.cscId));

  let parametros: string;
  if (input.emissionType === 9) {
    if (!input.offline) throw new Error("A contingência offline exige os dados extras do QR Code.");
    const dia = String(input.offline.issuedAt.getDate()).padStart(2, "0");
    parametros = [
      input.accessKey,
      "2",
      tpAmb,
      dia,
      centsToHex(input.offline.totalCents),
      // O digest vai em hexadecimal minúsculo, conforme o manual.
      Buffer.from(input.offline.digestValue, "base64").toString("hex").toLowerCase(),
      idToken,
    ].join("|");
  } else {
    parametros = [input.accessKey, "2", tpAmb, idToken].join("|");
  }

  const hash = createHash("sha1").update(`${parametros}${input.cscToken}`, "utf8").digest("hex");
  const separador = base.includes("?") ? "&" : "?";
  return `${base}${separador}p=${parametros}|${hash}`;
}

/** No QR da contingência o valor vai como decimal com duas casas, sem ponto. */
function centsToHex(cents: number) {
  return (Math.abs(cents) / 100).toFixed(2);
}
