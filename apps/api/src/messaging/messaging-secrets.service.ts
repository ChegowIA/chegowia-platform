import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** Mantém tokens Meta fora de respostas, logs e do JSON de configuração público. */
@Injectable()
export class MessagingSecretsService {
  encrypt(value: string) {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decrypt(payload: string) {
    const [version, ivValue, tagValue, ciphertextValue] = payload.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
      throw new ServiceUnavailableException("A credencial do WhatsApp não está em um formato válido.");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new ServiceUnavailableException("Não foi possível ler a credencial segura do WhatsApp.");
    }
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
    const raw = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim();
    if (!raw) {
      throw new ServiceUnavailableException(
        "Configure WHATSAPP_TOKEN_ENCRYPTION_KEY para vincular um número do WhatsApp Business.",
      );
    }
    const decoded = /^[a-f0-9]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (decoded.length !== 32) {
      throw new ServiceUnavailableException(
        "WHATSAPP_TOKEN_ENCRYPTION_KEY deve ser uma chave de 32 bytes em Base64 ou hexadecimal.",
      );
    }
    return decoded;
  }
}
