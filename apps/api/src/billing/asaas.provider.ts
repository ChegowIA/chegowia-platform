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
  /** O Asaas marca a cobrança apagada em vez de removê-la da API. */
  deleted?: boolean;
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

export type AsaasTransfer = {
  id: string;
  /** PENDING, BANK_PROCESSING, DONE, FAILED, CANCELLED. */
  status: string;
  value: number;
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

  /**
   * Cobrança por referência nossa. Substitui a chave de idempotência que a API
   * deles não tem: uma resposta perdida depois de criar a cobrança faria a
   * tentativa seguinte cobrar o mesmo consumo duas vezes.
   */
  async findPaymentByReference(externalReference: string): Promise<AsaasPayment | null> {
    const result = await this.request(
      `/payments?externalReference=${encodeURIComponent(externalReference)}&limit=1`,
      { method: "GET" },
    );
    const found = Array.isArray(result?.data) ? result.data[0] : null;
    return found?.id ? found : null;
  }

  async getPayment(paymentId: string): Promise<AsaasPayment> {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  }

  /**
   * Como `getPayment`, mas devolve null quando a cobrança não existe mais.
   *
   * A distinção importa: tratar erro de rede como "não existe" faria o consumo já
   * faturado voltar para a fila e ser cobrado duas vezes.
   */
  async findPayment(paymentId: string): Promise<AsaasPayment | null> {
    return this.request(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET", notFoundAsNull: true });
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
    birthDate?: string;
    companyType?: string;
    incomeValue: number;
    address?: string;
    addressNumber?: string;
    complement?: string;
    province?: string;
    postalCode?: string;
  }): Promise<AsaasSubaccount> {
    const result = await this.request("/accounts", { method: "POST", body: params });
    if (!result?.walletId) {
      throw new BadGatewayException("O Asaas não devolveu a carteira da subconta criada.");
    }
    return { id: String(result.id ?? ""), walletId: String(result.walletId), apiKey: result.apiKey ?? null };
  }

  /**
   * Subconta já aberta para o mesmo documento. O Asaas não aceita chave de
   * idempotência: se a criação falhar depois de gravar do lado deles, a segunda
   * tentativa devolve "já existe conta com este CPF/CNPJ" e o revendedor ficaria
   * travado. Aqui recuperamos a carteira em vez de recriar.
   *
   * A `apiKey` não volta nesta consulta — ela existe uma única vez, na criação.
   */
  async findSubaccountByDocument(cpfCnpj: string): Promise<AsaasSubaccount | null> {
    const result = await this.request(`/accounts?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=1`, { method: "GET" });
    const found = Array.isArray(result?.data) ? result.data[0] : null;
    if (!found?.walletId) return null;
    return { id: String(found.id ?? ""), walletId: String(found.walletId), apiKey: null };
  }

  // ---------------------------------------------------------------------------
  // Transferências
  // ---------------------------------------------------------------------------

  /**
   * Transferência entre a conta raiz e uma subconta. Segundo a documentação do
   * Asaas, costuma ser gratuita e imediata. Ainda assim, quem chama deve
   * respeitar o status devolvido e só concluir o saque em `DONE`.
   */
  async transferToWallet(params: {
    value: number;
    walletId: string;
    externalReference?: string;
  }): Promise<AsaasTransfer> {
    const result = await this.request("/transfers", { method: "POST", body: params });
    if (!result?.id) throw new BadGatewayException("O Asaas não devolveu o identificador da transferência.");
    return { id: String(result.id), status: String(result.status ?? "PENDING"), value: Number(result.value ?? params.value) };
  }

  /**
   * Transferências recentes. Serve para reconciliar depois de uma queda entre a
   * chamada e a gravação: sem chave de idempotência, é a `externalReference` que
   * prova se o lote já saiu.
   */
  async findTransferByReference(externalReference: string): Promise<AsaasTransfer | null> {
    const result = await this.request(
      `/transfers?externalReference=${encodeURIComponent(externalReference)}&limit=1`,
      { method: "GET" },
    );
    const found = Array.isArray(result?.data) ? result.data[0] : null;
    if (!found?.id) return null;
    return { id: String(found.id), status: String(found.status ?? "PENDING"), value: Number(found.value ?? 0) };
  }

  /** Saldo da conta autenticada; usado para conferir antes de transferir. */
  async balance(): Promise<{ balance: number }> {
    return this.request("/finance/balance", { method: "GET" });
  }

  // ---------------------------------------------------------------------------
  // Transporte
  // ---------------------------------------------------------------------------

  private async request(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: unknown; notFoundAsNull?: boolean },
  ) {
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

    // 404 só vira null a pedido de quem chama: confundir "não existe" com falha
    // de rede levaria a decisões erradas sobre dinheiro.
    if (response.status === 404 && init.notFoundAsNull) return null;

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
