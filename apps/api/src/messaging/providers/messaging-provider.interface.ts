/**
 * Abstração de canal de mensageria. Fase 1 só usa `buildContactLink` (wa.me, sem
 * custo, sem API oficial). Fase 2 (WhatsApp Business API/webhook) implementa `send`
 * de verdade nesta mesma interface — o resto do sistema (MessagingService,
 * controllers) não muda.
 */
export interface MessagingProvider {
  buildContactLink(phoneNumber: string, message: string): string;
  /** Fase 2: enviar mensagem de fato via API oficial. Não implementado na Fase 1. */
  send?(phoneNumber: string, message: string): Promise<void>;
}

export const MESSAGING_PROVIDER = Symbol("MESSAGING_PROVIDER");
