import { Injectable } from "@nestjs/common";
import { MessagingProvider } from "./messaging-provider.interface";

/**
 * Fase 1 — sem custo, sem API oficial. Gera só o link `wa.me` com mensagem
 * pré-preenchida; quem envia é o próprio usuário, abrindo o WhatsApp dele.
 * Não faz nenhuma automação de envio (evitar WhatsApp Web scraping — risco de
 * bloqueio de número e violação dos termos do WhatsApp).
 */
@Injectable()
export class LinkWhatsappProvider implements MessagingProvider {
  buildContactLink(phoneNumber: string, message: string): string {
    const digits = phoneNumber.replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }
}
