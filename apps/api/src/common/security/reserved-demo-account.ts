/**
 * Endereços deste domínio pertencem exclusivamente à operação criada pelo
 * script de infraestrutura `setup-demo-company.js`. Nenhum fluxo HTTP normal
 * pode criar ou aprovar uma conta com eles: isso evita colisão com as contas
 * descartáveis e impede que alguém tente obter o comportamento de teste pelo
 * cadastro público.
 */
export const RESERVED_DEMO_EMAIL_DOMAIN = "demo.chegowia.invalid";

export function isReservedDemoEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${RESERVED_DEMO_EMAIL_DOMAIN}`);
}
