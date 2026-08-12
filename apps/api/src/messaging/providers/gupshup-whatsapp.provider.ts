import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

type GupshupAppToken = {
  token: string;
  expiresAt: Date;
};

type GupshupAppDetails = {
  id: string;
  name?: string | null;
  phone?: string | null;
  /** Estado do onboarding na Meta; só há número utilizável quando fica "LIVE". */
  healthy?: boolean | null;
  live?: boolean | null;
  raw: unknown;
};

type GupshupSendResult = { messageId: string | null; raw: unknown };

/**
 * `source` e `appName` só são usados no self-serve, onde uma única apikey atende
 * todos os apps da conta e é o par número + nome do app que identifica o canal.
 * No modo partner o próprio appId na URL já resolve isso.
 */
export type GupshupSendParams = {
  appId: string;
  appToken: string;
  to: string;
  source?: string | null;
  appName?: string | null;
};

/** Campos aceitos pelo perfil comercial do WhatsApp exposto pelo Gupshup. */
export type GupshupBusinessProfile = {
  about?: string | null;
  address?: string | null;
  description?: string | null;
  email?: string | null;
  website1?: string | null;
  website2?: string | null;
  vertical?: string | null;
  profilePictureUrl?: string | null;
};

/**
 * Cliente da Partner API do Gupshup.
 *
 * O envio e o webhook usam as Passthrough APIs, que reproduzem o formato da
 * Meta — por isso o corpo montado aqui é idêntico ao do MetaWhatsAppProvider e
 * o parser de callback é compartilhado. O que diverge é o transporte: a Partner
 * API recebe form-urlencoded com os objetos aninhados serializados em JSON.
 *
 * Autenticação tem dois níveis: um token de parceiro (conta da plataforma, vale
 * ~24h e serve para administrar apps) e um token por app (usado no envio e no
 * perfil). Ambos expiram, então nada aqui assume credencial permanente.
 */
@Injectable()
export class GupshupWhatsAppProvider {
  private readonly logger = new Logger(GupshupWhatsAppProvider.name);
  private readonly baseUrl = (process.env.GUPSHUP_PARTNER_API_BASE_URL ?? "https://partner.gupshup.io/partner").replace(/\/$/, "");
  /**
   * Token de parceiro é global à plataforma, não ao tenant. Fica em memória com
   * margem de expiração para não repetir login a cada chamada administrativa —
   * e nunca é persistido, já que é derivado de credenciais de ambiente.
   */
  private partnerToken: { value: string; expiresAt: number } | null = null;

  private readonly apiUrl = (process.env.GUPSHUP_API_BASE_URL ?? "https://api.gupshup.io").replace(/\/$/, "");

  /**
   * SELF_SERVE usa a conta comum do gupshup.io: uma única `apikey` e apps
   * criados à mão no painel deles. PARTNER usa a Partner API, que automatiza a
   * criação de app por cliente mas exige aprovação no programa de parceiros
   * (que por sua vez exige o Tech Provider Program da Meta).
   */
  mode(): "SELF_SERVE" | "PARTNER" {
    return process.env.GUPSHUP_MODE === "PARTNER" ? "PARTNER" : "SELF_SERVE";
  }

  isConfigured() {
    return this.mode() === "PARTNER"
      ? Boolean(process.env.GUPSHUP_PARTNER_EMAIL?.trim() && process.env.GUPSHUP_PARTNER_PASSWORD?.trim())
      : Boolean(process.env.GUPSHUP_API_KEY?.trim());
  }

  isEnabled() {
    return process.env.GUPSHUP_ENABLED === "true" && this.isConfigured();
  }

  /** No self-serve o onboarding é manual: não há API para criar app por cliente. */
  supportsAutomaticOnboarding() {
    return this.mode() === "PARTNER";
  }

  private apiKey() {
    const key = process.env.GUPSHUP_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException("Configure GUPSHUP_API_KEY para usar o WhatsApp pelo Gupshup.");
    }
    return key;
  }

  // ---------------------------------------------------------------------------
  // Onboarding (token de parceiro)
  // ---------------------------------------------------------------------------

  /** Cria o app que hospedará o número da empresa no Gupshup. */
  async createApp(params: { name: string; templateMessaging?: boolean }): Promise<{ appId: string; name: string }> {
    const result = await this.partnerRequest("/app", {
      method: "POST",
      form: {
        name: params.name,
        templateMessaging: String(params.templateMessaging ?? true),
      },
    });
    const appId = String(result?.appId ?? result?.id ?? "");
    if (!appId) {
      throw new BadGatewayException("O Gupshup não devolveu o identificador do aplicativo criado.");
    }
    return { appId, name: String(result?.name ?? params.name) };
  }

  /**
   * Link oficial de Embedded Signup gerado pelo Gupshup. É ele que substitui o
   * App Review próprio: quem responde à Meta é o Gupshup, não a ChegowIA.
   */
  async generateEmbedLink(appId: string): Promise<string> {
    const result = await this.partnerRequest(`/app/${encodeURIComponent(appId)}/onboarding/embed-link`, {
      method: "GET",
    });
    const link = typeof result?.link === "string" ? result.link : typeof result?.url === "string" ? result.url : "";
    if (!link) {
      throw new BadGatewayException("O Gupshup não devolveu o link de conexão para este número.");
    }
    return link;
  }

  async getAppDetails(appId: string): Promise<GupshupAppDetails> {
    const result = await this.partnerRequest(`/app/${encodeURIComponent(appId)}/details`, { method: "GET" });
    const app = result?.app ?? result;
    return {
      id: String(app?.id ?? app?.appId ?? appId),
      name: typeof app?.name === "string" ? app.name : null,
      phone: typeof app?.phone === "string" ? app.phone : null,
      healthy: typeof app?.healthy === "boolean" ? app.healthy : null,
      live: typeof app?.live === "boolean" ? app.live : null,
      raw: app,
    };
  }

  /** Aponta o callback v3 (formato Meta) deste app para a nossa API. */
  async setCallbackUrl(appId: string, url: string) {
    await this.partnerRequest(`/app/${encodeURIComponent(appId)}/callback`, {
      method: "PUT",
      form: { callbackUrl: url },
    });
  }

  /**
   * Busca um token de app novo. Quem chama é responsável por persistir cifrado;
   * este provider não conhece o banco.
   */
  async fetchAppToken(appId: string): Promise<GupshupAppToken> {
    const result = await this.partnerRequest(`/app/${encodeURIComponent(appId)}/token`, { method: "GET" });
    const token = typeof result?.token === "string" ? result.token : result?.token?.token;
    if (typeof token !== "string" || !token) {
      throw new BadGatewayException("O Gupshup não devolveu um token válido para este aplicativo.");
    }
    // A Partner API documenta validade de 24h. Guardamos com folga de uma hora
    // para renovar antes de uma mensagem falhar por credencial vencida.
    return { token, expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000) };
  }

  // ---------------------------------------------------------------------------
  // Envio (token de app, formato Meta via passthrough v3)
  // ---------------------------------------------------------------------------

  async sendText(params: GupshupSendParams & { body: string }): Promise<GupshupSendResult> {
    if (this.mode() === "SELF_SERVE") {
      return this.sendSelfServe(params, { type: "text", text: params.body });
    }
    return this.sendMessage(params.appId, params.appToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(params.to),
      type: "text",
      text: { preview_url: false, body: params.body },
    });
  }

  async sendChoiceMenu(params: GupshupSendParams & { body: string }): Promise<GupshupSendResult> {
    if (this.mode() === "SELF_SERVE") {
      // O self-serve monta botões pelo formato próprio do Gupshup ("quick_reply"),
      // e não pelo objeto interactive da Meta.
      return this.sendSelfServe(params, {
        type: "quick_reply",
        msgid: "chegowia:menu",
        content: { type: "text", text: params.body },
        options: [
          { type: "text", title: "Atendente virtual", postbackText: "chegowia:virtual" },
          { type: "text", title: "Falar com humano", postbackText: "chegowia:human" },
        ],
      });
    }
    return this.sendMessage(params.appId, params.appToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(params.to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: params.body },
        action: {
          buttons: [
            { type: "reply", reply: { id: "chegowia:virtual", title: "Atendente virtual" } },
            { type: "reply", reply: { id: "chegowia:human", title: "Falar com humano" } },
          ],
        },
      },
    });
  }

  /**
   * Envio pela API comum do gupshup.io. Aqui o número de origem viaja no corpo
   * (`source`) porque uma única apikey atende todos os apps da conta — é o app
   * name que amarra a mensagem ao número certo.
   */
  private async sendSelfServe(params: GupshupSendParams, message: Record<string, unknown>): Promise<GupshupSendResult> {
    if (!params.source || !params.appName) {
      throw new ServiceUnavailableException("O canal do Gupshup está sem número de origem ou nome do aplicativo.");
    }
    const raw = await this.performRequest(`${this.apiUrl}/wa/api/v1/msg`, {
      method: "POST",
      headers: { apikey: this.apiKey(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        channel: "whatsapp",
        source: normalizePhone(params.source),
        destination: normalizePhone(params.to),
        "src.name": params.appName,
        message: JSON.stringify(message),
      }).toString(),
    });
    /**
     * A API v1 do Gupshup responde HTTP 200 mesmo quando recusa, sinalizando o
     * problema apenas no corpo (`status: "error"`). Confiar no código HTTP fazia
     * a mensagem ser gravada como enviada sem `providerMessageId`, de modo que
     * nenhum evento de status a encontrava depois: ela ficava "enviada" para
     * sempre sem nunca ter saído.
     */
    const messageId = readString(raw?.messageId);
    const status = readString(raw?.status);
    if (!messageId || (status && status.toLowerCase() !== "submitted")) {
      const detail = readString(raw?.message) ?? readString(raw?.reason) ?? status;
      this.logger.warn(
        `Gupshup aceitou a requisição mas não enviou (${params.appName ?? "app"}): ${JSON.stringify(raw).slice(0, 300)}`,
      );
      throw new BadGatewayException(
        detail && detail.length < 160
          ? `O Gupshup não enviou a mensagem: ${detail}`
          : "O Gupshup não enviou a mensagem. Confira o número de origem e o nome do aplicativo.",
      );
    }
    return { messageId, raw };
  }

  private async sendMessage(appId: string, appToken: string, payload: Record<string, unknown>): Promise<GupshupSendResult> {
    const raw = await this.appRequest(`/app/${encodeURIComponent(appId)}/v3/message`, {
      method: "POST",
      appToken,
      // O passthrough recebe os campos da Meta como form fields; objetos vão
      // serializados em JSON, e não como corpo JSON inteiro.
      form: flattenMetaPayload(payload),
    });
    const messageId =
      raw?.messages?.[0]?.id ??
      (typeof raw?.messageId === "string" ? raw.messageId : null);
    return { messageId: messageId ?? null, raw };
  }

  // ---------------------------------------------------------------------------
  // Perfil comercial
  // ---------------------------------------------------------------------------

  async getBusinessProfile(params: { appId: string; appToken: string }): Promise<GupshupBusinessProfile> {
    const result = await this.appRequest(`/app/${encodeURIComponent(params.appId)}/business/profile`, {
      method: "GET",
      appToken: params.appToken,
    });
    const profile = result?.profile ?? result;
    return {
      about: readString(profile?.about),
      address: readString(profile?.address),
      description: readString(profile?.description),
      email: readString(profile?.email),
      website1: readString(profile?.website1) ?? readString(profile?.websites?.[0]),
      website2: readString(profile?.website2) ?? readString(profile?.websites?.[1]),
      vertical: readString(profile?.vertical),
    };
  }

  async updateBusinessProfile(params: { appId: string; appToken: string; profile: GupshupBusinessProfile }) {
    const form: Record<string, string> = {};
    // Só enviamos o que o empresário mexeu. Mandar campo vazio apagaria dado já
    // aprovado no perfil da Meta sem que ele tenha pedido isso.
    for (const [key, value] of Object.entries(params.profile)) {
      if (value === undefined || value === null) continue;
      form[key] = String(value);
    }
    if (Object.keys(form).length === 0) return;
    await this.appRequest(`/app/${encodeURIComponent(params.appId)}/business/profile`, {
      method: "PUT",
      appToken: params.appToken,
      form,
    });
  }

  async getProfilePhotoUrl(params: { appId: string; appToken: string }): Promise<string | null> {
    const result = await this.appRequest(`/app/${encodeURIComponent(params.appId)}/business/profile/photo`, {
      method: "GET",
      appToken: params.appToken,
    });
    return readString(result?.profileImageUrl) ?? readString(result?.imageUrl) ?? readString(result?.url) ?? null;
  }

  /** A foto sobe como multipart; o Gupshup repassa o upload para a Meta. */
  async updateProfilePhoto(params: {
    appId: string;
    appToken: string;
    file: { buffer: Buffer; mimeType: string; fileName: string };
  }) {
    const body = new FormData();
    body.append(
      "image",
      new Blob([new Uint8Array(params.file.buffer)], { type: params.file.mimeType }),
      params.file.fileName,
    );
    const selfServe = this.mode() === "SELF_SERVE";
    const url = selfServe
      ? `${this.apiUrl}/wa/app/${encodeURIComponent(params.appId)}/business/profile/photo`
      : `${this.baseUrl}/app/${encodeURIComponent(params.appId)}/business/profile/photo`;
    await this.performRequest(url, {
      method: "PUT",
      // multipart: o boundary é definido pelo FormData, então não fixamos
      // Content-Type aqui.
      headers: selfServe ? { apikey: this.apiKey() } : { Authorization: params.appToken },
      body,
    });
  }

  // ---------------------------------------------------------------------------
  // Transporte
  // ---------------------------------------------------------------------------

  /**
   * Faz login na conta de parceiro e reaproveita o token enquanto ele durar.
   * Sem isto, cada criação de app custaria uma autenticação extra.
   */
  private async partnerTokenValue(): Promise<string> {
    const email = process.env.GUPSHUP_PARTNER_EMAIL?.trim();
    const password = process.env.GUPSHUP_PARTNER_PASSWORD?.trim();
    if (!email || !password) {
      throw new ServiceUnavailableException(
        "Configure GUPSHUP_PARTNER_EMAIL e GUPSHUP_PARTNER_PASSWORD para conectar números pelo Gupshup.",
      );
    }
    if (this.partnerToken && this.partnerToken.expiresAt > Date.now()) {
      return this.partnerToken.value;
    }
    const result = await this.performRequest(`${this.baseUrl}/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }).toString(),
    });
    const token = typeof result?.token === "string" ? result.token : "";
    if (!token) {
      throw new BadGatewayException("O Gupshup recusou as credenciais de parceiro da plataforma.");
    }
    this.partnerToken = { value: token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
    return token;
  }

  private async partnerRequest(path: string, params: { method: "GET" | "POST" | "PUT"; form?: Record<string, string> }) {
    const token = await this.partnerTokenValue();
    try {
      return await this.performRequest(`${this.baseUrl}${path}`, {
        method: params.method,
        headers: {
          Authorization: token,
          ...(params.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(params.form ? { body: new URLSearchParams(params.form).toString() } : {}),
      });
    } catch (error) {
      // Token de parceiro vencido antes da margem: renova uma vez e repete. Se
      // falhar de novo, o erro sobe normalmente.
      if (error instanceof BadGatewayException && this.partnerToken) {
        this.partnerToken = null;
        const renewed = await this.partnerTokenValue();
        return this.performRequest(`${this.baseUrl}${path}`, {
          method: params.method,
          headers: {
            Authorization: renewed,
            ...(params.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          },
          ...(params.form ? { body: new URLSearchParams(params.form).toString() } : {}),
        });
      }
      throw error;
    }
  }

  /**
   * Perfil e consultas por app existem nos dois modos, em bases e com headers
   * distintos: `partner.gupshup.io/partner/app/...` com token de app no partner,
   * `api.gupshup.io/wa/app/...` com apikey no self-serve.
   */
  private async appRequest(
    path: string,
    params: { method: "GET" | "POST" | "PUT"; appToken: string; form?: Record<string, string> },
  ) {
    const selfServe = this.mode() === "SELF_SERVE";
    const url = selfServe
      ? `${this.apiUrl}/wa${path}`
      : `${this.baseUrl}${path}`;
    return this.performRequest(url, {
      method: params.method,
      headers: {
        ...(selfServe ? { apikey: this.apiKey() } : { Authorization: params.appToken }),
        ...(params.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(params.form ? { body: new URLSearchParams(params.form).toString() } : {}),
    });
  }

  private async performRequest(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: BodyInit },
  ) {
    let response: Response;
    try {
      response = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
    } catch {
      throw new BadGatewayException("Não foi possível alcançar a API do Gupshup.");
    }

    const rawText = await response.text().catch(() => "");
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.message ?? payload?.error?.message ?? payload?.error;
      // O detalhe entra no log, não na resposta: mensagens do BSP podem citar
      // ativos de outro tenant e não ajudam o empresário no caminho guiado.
      this.logger.warn(`Gupshup recusou ${init.method} ${url}: ${response.status} ${rawText.slice(0, 300)}`);
      throw new BadGatewayException(
        typeof detail === "string" && detail.length < 160
          ? `O Gupshup recusou a operação: ${detail}`
          : "O Gupshup recusou a operação do WhatsApp.",
      );
    }
    return payload;
  }
}

/**
 * Converte o corpo no formato Meta para os campos aceitos pelo passthrough:
 * escalares viram string, objetos e listas vão em JSON.
 */
function flattenMetaPayload(payload: Record<string, unknown>): Record<string, string> {
  const form: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    form[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return form;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}
