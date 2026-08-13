import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export type AsaasBillingType = "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";

export type AsaasCustomer = {
  id: string;
  name: string;
  email?: string | null;
  cpfCnpj?: string | null;
};

export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  billingType: string;
  invoiceUrl?: string | null;
  subscription?: string | null;
  customer?: string | null;
};

export type AsaasSubscription = {
  id: string;
  status: string;
  value: number;
  nextDueDate?: string | null;
  customer?: string | null;
};

export type AsaasSubaccount = {
  id: string;
  walletId: string;
  /** Devolvida uma única vez, na criação. Sem guardá-la agora não há como obtê-la depois. */
  apiKey?: string | null;
};

/**
 * Cliente da API do Asaas.
 *
 * Autenticação é o header `access_token` com a chave da conta. A chave carrega o
 * ambiente: `$aact_prod_` responde só em api.asaas.com e `$aact_hmlg_` só em
 * api-sandbox.asaas.com — usar a chave no host errado devolve 401, que é a
 * confusão mais comum ao configurar.
 *
 * Diferente do Stripe, aqui não há catálogo de preços: o valor vai direto na
 * criação da assinatura, e alterar a mensalidade é atualizar a assinatura.
 */
@Injectable()
export class AsaasProvider {
  private readonly logger = new Logger(AsaasProvider.name);

  private baseUrl() {
    const configured = process.env.ASAAS_API_BASE_URL?.trim();
    if (configured) return configured.replace(/\/$/, "");
    // O ambiente é deduzido da própria chave: uma variável a menos para errar.
    return this.apiKey().startsWith("$aact_prod_")
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  }

  private apiKey() {
    const key = process.env.ASAAS_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException("Configure ASAAS_API_KEY para usar a cobrança pelo Asaas.");
    }
    return key;
  }

  isConfigured() {
    return Boolean(process.env.ASAAS_API_KEY?.trim());
  }

  /** Produção só quando a chave é de produção; evita cobrar de verdade sem querer. */
  isProduction() {
    return Boolean(process.env.ASAAS_API_KEY?.trim().startsWith("$aact_prod_"));
  }

  // ---------------------------------------------------------------------------
  // Clientes
  // ---------------------------------------------------------------------------

  async createCustomer(params: {
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string | null;
    externalReference?: string | null;
  }): Promise<AsaasCustomer> {
    return this.request("/customers", { method: "POST", body: params });
  }

  async updateCustomer(customerId: string, params: Record<string, unknown>): Promise<AsaasCustomer> {
    return this.request(`/customers/${encodeURIComponent(customerId)}`, { method: "POST", body: params });
  }

  // ---------------------------------------------------------------------------
  // Assinaturas
  // ---------------------------------------------------------------------------

  async createSubscription(params: {
    customer: string;
    value: number;
    nextDueDate: string;
    description?: string;
    billingType?: AsaasBillingType;
    externalReference?: string;
    /** Repasse automático. Não usamos hoje: a comissão respeita carência e sai por transferência. */
    split?: Array<{ walletId: string; percentualValue?: number; fixedValue?: number }>;
  }): Promise<AsaasSubscription> {
    return this.request("/subscriptions", {
      method: "POST",
      body: { cycle: "MONTHLY", billingType: "UNDEFINED", ...params },
    });
  }

  async updateSubscription(subscriptionId: string, params: Record<string, unknown>): Promise<AsaasSubscription> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "POST", body: params });
  }

  async cancelSubscription(subscriptionId: string) {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
  }

  async getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
    return this.request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "GET" });
  }

  /** Cobranças de uma assinatura, da mais recente para a mais antiga. */
  async listSubscriptionPayments(subscriptionId: string): Promise<AsaasPayment[]> {
    const result = await this.request(
      `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=20`,
      { method: "GET" },
    );
    return Array.isArray(result?.data) ? result.data : [];
  }

  // ---------------------------------------------------------------------------
  // Cobranças avulsas
  // ---------------------------------------------------------------------------

  async createPayment(params: {
    customer: string;
    value: number;
    dueDate: string;
    description?: string;
    billingType?: AsaasBillingType;
    externalReference?: string;
  }): Promise<AsaasPayment> {
    return this.request("/payments", { method: "POST", body: { billingType: "UNDEFINED", ...params } });
  }

  async getPayment(paymentId: string): Promise<AsaasPayment> {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  }

  async updatePayment(paymentId: string, params: Record<string, unknown>): Promise<AsaasPayment> {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: "POST", body: params });
  }

  // ---------------------------------------------------------------------------
  // Subcontas do revendedor
  // ---------------------------------------------------------------------------

  /**
   * Cria a subconta que recebe a comissão. A resposta traz `apiKey` uma única
   * vez — quem chama precisa persistir imediatamente, porque não há endpoint
   * para recuperá-la depois.
   */
  async createSubaccount(params: {
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone?: string;
    incomeValue: number;
    address?: string;
    addressNumber?: string;
    province?: string;
    postalCode?: string;
  }): Promise<AsaasSubaccount> {
    const result = await this.request("/accounts", { method: "POST", body: params });
    if (!result?.walletId) {
      throw new BadGatewayException("O Asaas não devolveu a carteira da subconta criada.");
    }
    return { id: String(result.id ?? ""), walletId: String(result.walletId), apiKey: result.apiKey ?? null };
  }

  // ---------------------------------------------------------------------------
  // Transferências
  // ---------------------------------------------------------------------------

  /**
   * Transferência entre a conta raiz e uma subconta. Segundo a documentação do
   * Asaas, é gratuita e imediata — é o que permite manter a carência de 7 dias
   * da comissão sem custo, em vez de repassar no ato pelo split.
   */
  async transferToWallet(params: { value: number; walletId: string; externalReference?: string }) {
    return this.request("/transfers", { method: "POST", body: params });
  }

  /** Saldo da conta autenticada; usado para conferir antes de transferir. */
  async balance(): Promise<{ balance: number }> {
    return this.request("/finance/balance", { method: "GET" });
  }

  // ---------------------------------------------------------------------------
  // Transporte
  // ---------------------------------------------------------------------------

  private async request(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown }) {
    const url = `${this.baseUrl()}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          access_token: this.apiKey(),
          "Content-Type": "application/json",
          // O Asaas pede identificação da aplicação nas chamadas.
          "User-Agent": "ChegowIA",
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new BadGatewayException("Não foi possível alcançar a API do Asaas.");
    }

    const rawText = await response.text().catch(() => "");
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // O Asaas devolve os problemas em `errors[]`, com código e descrição.
      const detail = Array.isArray(payload?.errors)
        ? payload.errors.map((item: any) => item?.description).filter(Boolean).join("; ")
        : null;
      this.logger.error(`Asaas recusou ${init.method} ${path}: ${response.status} ${rawText.slice(0, 400)}`);
      throw new BadGatewayException(
        detail && detail.length < 300 ? `O Asaas recusou a operação: ${detail}` : "O Asaas recusou a operação.",
      );
    }

    // Erro de negócio também pode vir com HTTP 200 e `errors` no corpo.
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      const detail = payload.errors.map((item: any) => item?.description).filter(Boolean).join("; ");
      this.logger.error(`Asaas respondeu 200 com erro em ${init.method} ${path}: ${rawText.slice(0, 400)}`);
      throw new BadGatewayException(
        detail && detail.length < 300 ? `O Asaas recusou a operação: ${detail}` : "O Asaas recusou a operação.",
      );
    }

    return payload;
  }
}
