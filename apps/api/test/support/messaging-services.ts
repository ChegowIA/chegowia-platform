import { BillingService } from "../../src/billing/billing.service";
import { MessagingService } from "../../src/messaging/messaging.service";
import { PlatformWhatsAppService } from "../../src/messaging/platform-whatsapp.service";

/**
 * Construtores de teste por nome, não por posição.
 *
 * Os dois serviços recebem muitas dependências, e cada uma acrescentada no meio
 * da lista quebrava todos os testes de uma vez — aconteceu quatro vezes ao
 * integrar o Gupshup, e o erro nunca dizia qual argumento era qual. Aqui a
 * ordem vive num lugar só: acrescentar dependência passa a ser editar esta
 * função.
 */
type Dep = unknown;

export function buildMessagingService(deps: {
  prisma?: Dep;
  provider?: Dep;
  gupshup?: Dep;
  secrets?: Dep;
  mail?: Dep;
  storage?: Dep;
  ai?: Dep;
  usage?: Dep;
  realtime?: Dep;
  legacyTestData?: Dep;
  platformWhatsApp?: Dep;
} = {}) {
  return new MessagingService(
    (deps.prisma ?? {}) as never,
    (deps.provider ?? {}) as never,
    (deps.gupshup ?? {}) as never,
    (deps.secrets ?? {}) as never,
    (deps.mail ?? {}) as never,
    (deps.storage ?? {}) as never,
    (deps.ai ?? {}) as never,
    (deps.usage ?? {}) as never,
    (deps.realtime ?? {}) as never,
    (deps.legacyTestData ?? undefined) as never,
    (deps.platformWhatsApp ?? undefined) as never,
  );
}

export function buildPlatformWhatsAppService(deps: {
  prisma?: Dep;
  gupshup?: Dep;
  secrets?: Dep;
  storage?: Dep;
  aiProvider?: Dep;
  realtime?: Dep;
} = {}) {
  return new PlatformWhatsAppService(
    (deps.prisma ?? {}) as never,
    (deps.gupshup ?? {}) as never,
    (deps.secrets ?? {}) as never,
    (deps.storage ?? {}) as never,
    (deps.aiProvider ?? {}) as never,
    (deps.realtime ?? {}) as never,
  );
}

export function buildBillingService(deps: {
  prisma?: Dep;
  ai?: Dep;
  auth?: Dep;
  usage?: Dep;
  mail?: Dep;
  asaas?: Dep;
} = {}) {
  return new BillingService(
    (deps.prisma ?? {}) as never,
    (deps.ai ?? {}) as never,
    (deps.auth ?? {}) as never,
    (deps.usage ?? {}) as never,
    (deps.mail ?? {}) as never,
    (deps.asaas ?? {}) as never,
  );
}
