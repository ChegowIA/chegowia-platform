import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContextValue {
  /** Empresa à qual as queries devem ser restritas. Nulo quando `bypass` é true. */
  companyId: string | null;
  /**
   * Quando true, o Prisma extension de tenant NÃO aplica filtro automático —
   * usado para rotas de SUPER_ADMIN sem empresa selecionada e rotas públicas,
   * que devem filtrar `companyId` manualmente e de forma explícita no service.
   */
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantContextValue>();

export const tenantContext = {
  run<T>(value: TenantContextValue, fn: () => T): T {
    return storage.run(value, fn);
  },
  get(): TenantContextValue | undefined {
    return storage.getStore();
  },
  /** Helper para código público que já resolveu explicitamente o companyId (ex.: por slug). */
  runAsCompany<T>(companyId: string, fn: () => T): T {
    return storage.run({ companyId, bypass: false }, fn);
  },
};
