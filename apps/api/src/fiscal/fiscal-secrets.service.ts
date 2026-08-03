import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * Cifragem em repouso do certificado A1 e do CSC.
 *
 * Mesmo formato e mesmo algoritmo do `MessagingSecretsService` (AES-256-GCM,
 * `v1.iv.tag.ciphertext` em base64url), mas com **chave própria**: o que está
 * guardado aqui é a chave privada da empresa, com a qual se assina documento
 * fiscal em nome dela. Compartilhar a chave de cifragem com os tokens do
 * WhatsApp faria um vazamento de um virar vazamento do outro, e impediria
 * rotacionar um sem mexer no outro.
 */
@Injectable()
export class FiscalSecretsService {
  encrypt(value: Buffer | string) {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decryptToBuffer(payload: string) {
    const [version, ivValue, tagValue, ciphertextValue] = payload.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
      throw new ServiceUnavailableException("O certificado digital não está em um formato válido.");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]);
    } catch {
      // A mensagem não distingue chave errada de dado corrompido de propósito:
      // a diferença só interessa a quem está tentando adivinhar a chave.
      throw new ServiceUnavailableException("Não foi possível ler o certificado digital armazenado.");
    }
  }

  decrypt(payload: string) {
    return this.decryptToBuffer(payload).toString("utf8");
  }

  isConfigured() {
    try {
      this.key();
      return true;
    } catch {
      return false;
    }
  }

  private key() {
    const raw = process.env.FISCAL_ENCRYPTION_KEY?.trim();
    if (!raw) {
      throw new ServiceUnavailableException(
        "Configure FISCAL_ENCRYPTION_KEY para armazenar o certificado digital da empresa.",
      );
    }
    const decoded = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new ServiceUnavailableException(
        "FISCAL_ENCRYPTION_KEY deve ser uma chave de 32 bytes em Base64 ou hexadecimal.",
      );
    }
    return decoded;
  }
}
