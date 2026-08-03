import { BadRequestException } from "@nestjs/common";
import * as forge from "node-forge";

export interface CertificateMetadata {
  subjectName: string;
  issuerName: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  /** CNPJ encontrado no titular, quando o certificado é e-CNPJ. */
  document: string | null;
}

/**
 * Lê um certificado A1 (PKCS#12) para extrair titular, emissor e validade.
 *
 * Em JS puro de propósito: a alternativa seria o `openssl` da imagem, que exige
 * escrever o .pfx em disco. O container roda com sistema de arquivos somente
 * leitura e um arquivo com a chave privada da empresa, mesmo temporário, é
 * exatamente o que não pode existir.
 *
 * Os metadados são guardados em claro no banco para permitir o alerta de
 * expiração sem decifrar o certificado a cada verificação.
 */
export function readCertificate(content: Buffer, password: string): CertificateMetadata {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(content.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch {
    // A senha errada e o arquivo inválido caem no mesmo erro da biblioteca, e
    // separar os dois exigiria adivinhar. A mensagem cobre as duas causas.
    throw new BadRequestException(
      "Não foi possível abrir o certificado. Confira se o arquivo é um .pfx/.p12 válido e se a senha está correta.",
    );
  }

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificates = bags.map((bag) => bag.cert).filter(Boolean) as forge.pki.Certificate[];
  if (!certificates.length) {
    throw new BadRequestException("O arquivo não contém nenhum certificado.");
  }

  // Um A1 traz a cadeia inteira; o certificado do titular é o único que não
  // assina nenhum outro do pacote. Pegar o primeiro pode devolver a AC raiz.
  const issuers = new Set(certificates.map((certificate) => certificate.issuer.hash));
  const holder = certificates.find((certificate) => !issuers.has(certificate.subject.hash))
    ?? certificates[0];

  const subjectName = attributeValue(holder.subject, "commonName")
    ?? attributeValue(holder.subject, "organizationName")
    ?? "Titular não identificado";

  return {
    subjectName,
    issuerName: attributeValue(holder.issuer, "commonName") ?? "Emissor não identificado",
    serialNumber: holder.serialNumber,
    notBefore: holder.validity.notBefore,
    notAfter: holder.validity.notAfter,
    document: extractDocument(subjectName),
  };
}

function attributeValue(name: forge.pki.Certificate["subject"], shortOrName: string) {
  const attribute = name.attributes.find((item) => item.name === shortOrName);
  const value = attribute?.value;
  return typeof value === "string" ? value : null;
}

/**
 * No padrão ICP-Brasil o CN do e-CNPJ é "RAZÃO SOCIAL:00000000000000". Serve
 * para conferir se o certificado enviado pertence mesmo à empresa logada.
 */
function extractDocument(subjectName: string) {
  const match = subjectName.match(/:(\d{11,14})\s*$/);
  return match ? match[1] : null;
}
