import { randomInt } from "node:crypto";

/**
 * Chave de acesso da NFC-e: 44 caracteres que identificam o documento em todo o
 * país e que o consumidor digita no site da SEFAZ para consultar a nota.
 *
 * Composição (layout 4.00):
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 *
 * O dígito verificador é módulo 11 com pesos cíclicos de 2 a 9 aplicados da
 * direita para a esquerda. Errar o DV é rejeição imediata, e é o tipo de bug
 * que passa despercebido em homologação se o cálculo for testado só com um
 * exemplo — por isso a função é pura e tem teste próprio.
 */

/** Código numérico da UF na tabela do IBGE, usado no início da chave. */
export const UF_CODES: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29",
  MG: "31", ES: "32", RJ: "33", SP: "35",
  PR: "41", SC: "42", RS: "43",
  MS: "50", MT: "51", GO: "52", DF: "53",
};

export interface AccessKeyParts {
  uf: string;
  issuedAt: Date;
  cnpj: string;
  series: number;
  number: number;
  /** 1 normal, 9 contingência offline. */
  emissionType: number;
  /** Código numérico de 8 dígitos. Gere com `generateNumericCode`. */
  numericCode: string;
}

/**
 * Código numérico aleatório (cNF).
 *
 * A SEFAZ rejeita cNF igual ao número da nota (regra GA22), então o sorteio é
 * de um intervalo e a coincidência é conferida por quem monta a chave.
 */
export function generateNumericCode(nfNumber: number): string {
  let code = "";
  do {
    code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  } while (Number(code) === nfNumber);
  return code;
}

export function buildAccessKey(parts: AccessKeyParts): string {
  const cUF = UF_CODES[parts.uf.toUpperCase()];
  if (!cUF) throw new Error(`UF sem código IBGE conhecido: ${parts.uf}`);

  const ano = String(parts.issuedAt.getFullYear()).slice(-2);
  const mes = String(parts.issuedAt.getMonth() + 1).padStart(2, "0");
  const cnpj = parts.cnpj.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) throw new Error("CNPJ do emitente inválido para a chave de acesso.");

  const semDigito = [
    cUF,
    `${ano}${mes}`,
    cnpj,
    "65", // modelo 65 = NFC-e
    String(parts.series).padStart(3, "0"),
    String(parts.number).padStart(9, "0"),
    String(parts.emissionType),
    parts.numericCode.padStart(8, "0"),
  ].join("");

  if (semDigito.length !== 43) {
    throw new Error(`Chave de acesso malformada: ${semDigito.length} dígitos antes do DV.`);
  }
  return `${semDigito}${accessKeyCheckDigit(semDigito)}`;
}

/** Módulo 11, pesos 2..9 cíclicos da direita para a esquerda. */
export function accessKeyCheckDigit(first43: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = first43.length - 1; i >= 0; i -= 1) {
    soma += (first43[i].charCodeAt(0) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  // Resto 0 ou 1 produzem DV 0 — a regra da SEFAZ, não um arredondamento.
  return String(resto < 2 ? 0 : 11 - resto);
}

export function isValidAccessKey(key: string): boolean {
  const normalized = key.toUpperCase();
  if (!/^\d{6}[A-Z0-9]{12}\d{26}$/.test(normalized)) return false;
  return accessKeyCheckDigit(normalized.slice(0, 43)) === normalized[43];
}

/** Quebra a chave nos campos que a compõem, para telas e conferência. */
export function parseAccessKey(key: string) {
  if (!isValidAccessKey(key)) throw new Error("Chave de acesso inválida.");
  return {
    cUF: key.slice(0, 2),
    year: key.slice(2, 4),
    month: key.slice(4, 6),
    cnpj: key.slice(6, 20),
    model: key.slice(20, 22),
    series: Number(key.slice(22, 25)),
    number: Number(key.slice(25, 34)),
    emissionType: Number(key.slice(34, 35)),
    numericCode: key.slice(35, 43),
    checkDigit: key.slice(43),
  };
}
