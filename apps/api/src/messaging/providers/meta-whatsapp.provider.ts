import { BadGatewayException, Injectable } from "@nestjs/common";

type MetaPhoneDetails = {
  id: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
};

type MetaSendResult = { messageId: string | null; raw: unknown };

type MetaEmbeddedSignupToken = {
  accessToken: string;
  expiresInSeconds: number | null;
};

type MetaBusinessPortfolioDetails = {
  id: string;
  name?: string | null;
};

/** Cliente fino para a API oficial WhatsApp Cloud API da Meta. */
@Injectable()
export class MetaWhatsAppProvider {
  private readonly baseUrl = (process.env.META_GRAPH_API_BASE_URL ?? "https://graph.facebook.com").replace(/\/$/, "");
  private readonly version = process.env.META_GRAPH_API_VERSION ?? "v22.0";

  async getPhoneNumber(phoneNumberId: string, accessToken: string): Promise<MetaPhoneDetails> {
    const result = await this.request(`/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, {
      method: "GET",
      accessToken,
    });
    return {
      id: String(result?.id ?? ""),
      displayPhoneNumber: result?.display_phone_number ?? null,
      verifiedName: result?.verified_name ?? null,
      qualityRating: result?.quality_rating ?? null,
    };
  }

  /**
   * Troca o código de curta duração do Embedded Signup por um token de acesso.
   * O App Secret fica exclusivamente no servidor — o navegador nunca recebe nem
   * manipula este token.
   */
  async exchangeEmbeddedSignupCode(params: {
    appId: string;
    appSecret: string;
    code: string;
  }): Promise<MetaEmbeddedSignupToken> {
    const query = new URLSearchParams({
      client_id: params.appId,
      client_secret: params.appSecret,
      code: params.code,
    });
    const result = await this.requestWithoutAccessToken(`/oauth/access_token?${query.toString()}`);
    const accessToken = typeof result?.access_token === "string" ? result.access_token : "";
    if (!accessToken) {
      throw new BadGatewayException("A Meta não devolveu uma credencial válida para o número selecionado.");
    }
    const expires = Number(result?.expires_in);
    return {
      accessToken,
      expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : null,
    };
  }

  /**
   * Consulta o Business Portfolio retornado pelo Embedded Signup. Além de
   * validar o vínculo com a conta que autorizou o fluxo, esta chamada usa a
   * permissão business_management de maneira estritamente necessária ao
   * onboarding multiempresa.
   */
  async getBusinessPortfolio(businessPortfolioId: string, accessToken: string): Promise<MetaBusinessPortfolioDetails> {
    const result = await this.request(`/${encodeURIComponent(businessPortfolioId)}?fields=id,name`, {
      method: "GET",
      accessToken,
    });
    return {
      id: String(result?.id ?? ""),
      name: typeof result?.name === "string" ? result.name : null,
    };
  }

  /** Confirma que o número selecionado pertence mesmo ao WABA devolvido pela Meta. */
  async businessHasPhoneNumber(params: {
    businessAccountId: string;
    phoneNumberId: string;
    accessToken: string;
  }) {
    const result = await this.request(
      `/${encodeURIComponent(params.businessAccountId)}/phone_numbers?fields=id&limit=250`,
      { method: "GET", accessToken: params.accessToken },
    );
    return Array.isArray(result?.data) && result.data.some((phone: unknown) => {
      return typeof phone === "object" && phone !== null && String((phone as { id?: unknown }).id ?? "") === params.phoneNumberId;
    });
  }

  /** Assina o app nos eventos deste WABA; sem isto o inbox não recebe mensagens. */
  async subscribeAppToBusinessAccount(params: { businessAccountId: string; accessToken: string }) {
    await this.request(`/${encodeURIComponent(params.businessAccountId)}/subscribed_apps`, {
      method: "POST",
      accessToken: params.accessToken,
      body: {},
    });
  }

  /** Registra um número novo na Cloud API usando o PIN 2FA gerado no servidor. */
  async registerPhoneNumber(params: { phoneNumberId: string; accessToken: string; pin: string }) {
    await this.request(`/${encodeURIComponent(params.phoneNumberId)}/register`, {
      method: "POST",
      accessToken: params.accessToken,
      body: { messaging_product: "whatsapp", pin: params.pin },
    });
  }

  async sendText(params: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<MetaSendResult> {
    const raw = await this.request(`/${encodeURIComponent(params.phoneNumberId)}/messages`, {
      method: "POST",
      accessToken: params.accessToken,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizePhone(params.to),
        type: "text",
        text: { preview_url: false, body: params.body },
      },
    });
    return { messageId: raw?.messages?.[0]?.id ?? null, raw };
  }

  async sendChoiceMenu(params: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<MetaSendResult> {
    const raw = await this.request(`/${encodeURIComponent(params.phoneNumberId)}/messages`, {
      method: "POST",
      accessToken: params.accessToken,
      body: {
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
      },
    });
    return { messageId: raw?.messages?.[0]?.id ?? null, raw };
  }

  private async request(path: string, params: { method: "GET" | "POST"; accessToken: string; body?: unknown }) {
    return this.performRequest(`${this.baseUrl}/${this.version}${path}`, params);
  }

  private async requestWithoutAccessToken(path: string) {
    return this.performRequest(`${this.baseUrl}/${this.version}${path}`, { method: "GET" });
  }

  private async performRequest(
    url: string,
    params: { method: "GET" | "POST"; accessToken?: string; body?: unknown },
  ) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: params.method,
        headers: {
          ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
          ...(params.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(params.body ? { body: JSON.stringify(params.body) } : {}),
      });
    } catch {
      throw new BadGatewayException("Não foi possível alcançar a API do WhatsApp da Meta.");
    }

    const rawText = await response.text().catch(() => "");
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.error?.message;
      throw new BadGatewayException(
        detail ? `A Meta recusou a operação: ${String(detail)}` : "A Meta recusou a operação do WhatsApp.",
      );
    }
    return payload;
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}
