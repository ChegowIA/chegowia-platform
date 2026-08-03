import { SignedXml } from "xml-crypto";
import * as forge from "node-forge";

/**
 * Assinatura XMLDSig do documento fiscal.
 *
 * Os parâmetros não são escolha nossa: o manual da NF-e fixa
 * `rsa-sha1` + `sha1`, canonicalização C14N exclusiva e a transformação
 * enveloped-signature. Trocar por SHA-256 "porque é mais moderno" é rejeição
 * de schema — a SEFAZ valida a assinatura contra o XSD.
 *
 * A referência aponta para o `Id` do elemento assinado (`#NFe<chave>`), e a
 * `<Signature>` fica **irmã** do `infNFe`, dentro de `<NFe>`. Colocar fora
 * também é rejeição.
 */

const CANONICALIZATION = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const SIGNATURE_ALGORITHM = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const DIGEST_ALGORITHM = "http://www.w3.org/2000/09/xmldsig#sha1";

export interface SigningMaterial {
  /** Conteúdo do .pfx/.p12. */
  pfx: Buffer;
  password: string;
}

export interface ExtractedKeyPair {
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * Extrai chave privada e certificado do PKCS#12 em PEM.
 *
 * O `xml-crypto` trabalha com PEM; converter em memória evita o que a
 * alternativa exigiria — escrever a chave privada da empresa em disco, num
 * container que roda somente leitura justamente para isso não acontecer.
 */
export function extractKeyPair(material: SigningMaterial): ExtractedKeyPair {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(material.pfx.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, material.password);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]
    ?? [];
  const privateKey = keyBags[0]?.key;
  if (!privateKey) throw new Error("O certificado não contém chave privada utilizável.");

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certificates = certBags.map((bag) => bag.cert).filter(Boolean) as forge.pki.Certificate[];
  if (!certificates.length) throw new Error("O certificado não contém nenhum certificado X.509.");

  // O titular é o que não assina nenhum outro do pacote; pegar o primeiro
  // poderia devolver a AC raiz, e a SEFAZ conferiria a assinatura contra o
  // certificado errado.
  const issuers = new Set(certificates.map((certificate) => certificate.issuer.hash));
  const holder = certificates.find((certificate) => !issuers.has(certificate.subject.hash)) ?? certificates[0];

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(holder),
  };
}

/**
 * Assina um elemento identificado por `Id`.
 *
 * @param xml documento completo
 * @param referenceId valor do atributo Id (sem o `#`)
 * @param parentTag elemento dentro do qual a `<Signature>` deve ficar
 */
export function signXml(
  xml: string,
  referenceId: string,
  parentTag: string,
  keys: ExtractedKeyPair,
): string {
  const signer = new SignedXml({
    privateKey: keys.privateKeyPem,
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    canonicalizationAlgorithm: CANONICALIZATION,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${pemBody(keys.certificatePem)}</X509Certificate></X509Data>`,
  });

  signer.addReference({
    xpath: `//*[@Id='${referenceId}']`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      CANONICALIZATION,
    ],
    digestAlgorithm: DIGEST_ALGORITHM,
    uri: `#${referenceId}`,
  });

  signer.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${parentTag}']`, action: "append" },
  });

  return signer.getSignedXml();
}

/** Digest da referência, necessário no QR Code da contingência offline. */
export function extractDigestValue(signedXml: string): string {
  const match = signedXml.match(/<DigestValue>([^<]+)<\/DigestValue>/);
  if (!match) throw new Error("Assinatura sem DigestValue.");
  return match[1];
}

/** Remove cabeçalho, rodapé e quebras — o XML leva só o corpo em Base64. */
function pemBody(pem: string) {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}
