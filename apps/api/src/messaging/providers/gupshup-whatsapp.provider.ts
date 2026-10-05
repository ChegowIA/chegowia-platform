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

export type GupshupTemplate = {
  id: string;
  name: string;
  languageCode: string;
  category: string;
  status: string;
  content: string | null;
};

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

export type GupshupChoice = { title: string; description?: string };

/**
 * Perfil comercial do WhatsApp.
 *
 * O endereço é estruturado no Gupshup, não um texto único: mandar tudo em um
 * campo só fazia o restante ser descartado em silêncio. E `about` (o recado do
 * perfil) não existe neste endpoint — é por isso que ele não aparece aqui.
 */
export type GupshupBusinessProfile = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
  country?: string | null;
  description?: string | null;
  email?: string | null;
  website1?: string | null;
  website2?: string | null;
  vertical?: string | null;
  profilePictureUrl?: string | null;
};

/**
 * Os nomes que o Gupshup espera diferem dos nossos em três campos, e enviar o
 * nome errado não dá erro: o campo é simplesmente ignorado. Foi o que fez
 * e-mail, descrição e endereço não mudarem no WhatsApp mesmo com o painel
 * dizendo que salvou.
 */
const PROFILE_FIELD_NAMES: Record<string, string> = {
  addressLine1: "addLine1",
  addressLine2: "addLine2",
  city: "city",
  state: "state",
  pinCode: "pinCode",
  country: "country",
  description: "desc",
  email: "profileEmail",
  website1: "website1",
  website2: "website2",
  vertical: "vertical",
};

/**
 * Cliente da Partner API do Gupshup.
 *
 * O envio e o webhook usam as Passthrough APIs, que reproduzem o formato da
 * Meta — por isso o corpo montado aqui segue o mesmo desenho da Cloud API e o
 * parser de callback é compartilhado. O que diverge é o transporte: a Partner
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

  /** Modelos pertencem ao WABA do aplicativo, não à conta ChegowIA inteira. */
  async listTemplates(params: { appId: string; appToken: string }): Promise<GupshupTemplate[]> {
    const path = `/app/${encodeURIComponent(params.appId)}/${this.mode() === "SELF_SERVE" ? "template" : "templates"}`;
    const rows: any[] = [];
    // A API self-serve pagina em lotes de 100. Conferir só a primeira página
    // poderia criar um homônimo e deixar a loja sem avisos.
    for (let page = 0; page < 20; page++) {
      const result = await this.appRequest(this.mode() === "SELF_SERVE" ? `${path}?pageNo=${page}&pageSize=100` : path, {
        method: "GET", appToken: params.appToken,
      });
      this.assertGupshupAccepted(result, "consultar modelos");
      const batch = Array.isArray(result?.templates) ? result.templates
        : Array.isArray(result?.template) ? result.template
        : Array.isArray(result?.data) ? result.data
        : Array.isArray(result) ? result : null;
      if (!batch) throw new BadGatewayException("O Gupshup devolveu uma lista de modelos em formato inesperado.");
      rows.push(...batch);
      if (this.mode() !== "SELF_SERVE" || batch.length < 100) break;
    }
    return rows.map((row: any) => ({
      id: readString(row?.id) ?? "",
      name: readString(row?.elementName) ?? readString(row?.name) ?? "",
      languageCode: readString(row?.languageCode) ?? readString(row?.language) ?? "",
      category: readString(row?.category) ?? "",
      status: readString(row?.status) ?? "",
      content: readString(row?.content) ?? readString(row?.data),
    }));
  }

  /** Submete um modelo de texto Utility à revisão da Meta para este WABA. */
  async createUtilityTemplate(params: {
    appId: string;
    appToken: string;
    name: string;
    languageCode: string;
    content: string;
    example: string;
  }): Promise<GupshupTemplate> {
    const path = `/app/${encodeURIComponent(params.appId)}/${this.mode() === "SELF_SERVE" ? "template" : "templates"}`;
    const result = await this.appRequest(path, {
      method: "POST",
      appToken: params.appToken,
      form: {
        elementName: params.name,
        languageCode: params.languageCode,
        content: params.content,
        category: "UTILITY",
        vertical: "Atualizacao de pedido",
        templateType: "TEXT",
        example: params.example,
      },
    });
    this.assertGupshupAccepted(result, "criar modelo de pedido");
    const template = result?.template ?? result;
    const id = readString(template?.id);
    if (!id) throw new BadGatewayException("O Gupshup não devolveu o ID do modelo criado.");
    return {
      id,
      name: readString(template?.elementName) ?? params.name,
      languageCode: readString(template?.languageCode) ?? params.languageCode,
      category: readString(template?.category) ?? "UTILITY",
      status: readString(template?.status) ?? "PENDING",
      content: readString(template?.content) ?? params.content,
    };
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

  /** Cartão nativo do WhatsApp: o destinatário pode salvar o contato. */
  async sendContact(params: GupshupSendParams & { name: string; phone: string }): Promise<GupshupSendResult> {
    const waId = normalizePhone(params.phone);
    if (this.mode() === "SELF_SERVE") {
      return this.sendSelfServe(params, {
        type: "contact",
        contact: {
          name: { formattedName: params.name, firstName: "ChegowIA" },
          org: { company: "ChegowIA", department: "Atendimento" },
          phones: [{ phone: params.phone, type: "WORK", wa_id: waId }],
          urls: [{ url: "https://chegowia.com.br", type: "WORK" }],
        },
      });
    }
    return this.sendMessage(params.appId, params.appToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(params.to),
      type: "contacts",
      contacts: [{
        name: { formatted_name: params.name, first_name: "ChegowIA" },
        org: { company: "ChegowIA", department: "Atendimento" },
        phones: [{ phone: params.phone, type: "WORK", wa_id: waId }],
        urls: [{ url: "https://chegowia.com.br", type: "WORK" }],
      }],
    });
  }

  /** Botões para 2–3 alternativas; lista nativa para 4–10 alternativas. */
  async sendInteractiveChoices(params: GupshupSendParams & { body: string; choices: GupshupChoice[] }): Promise<GupshupSendResult> {
    const { choices, body } = params;
    if (choices.length < 2 || choices.length > 10) {
      throw new Error("O menu interativo exige de 2 a 10 opções.");
    }
    if (this.mode() === "SELF_SERVE") {
      if (choices.length <= 3) {
        return this.sendSelfServe(params, {
          type: "quick_reply",
          content: { type: "text", text: body },
          options: choices.map((choice) => ({ type: "text", title: choice.title, postbackText: choice.title })),
        });
      }
      return this.sendSelfServe(params, {
        type: "list",
        body,
        globalButtons: [{ type: "text", title: "Ver opções" }],
        items: [{
          title: "Escolha um assunto",
          options: choices.map((choice) => ({
            type: "text",
            title: choice.title,
            ...(choice.description ? { description: choice.description } : {}),
            postbackText: choice.title,
          })),
        }],
      });
    }
    return this.sendMessage(params.appId, params.appToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(params.to),
      type: "interactive",
      interactive: choices.length <= 3
        ? {
          type: "button",
          body: { text: body },
          action: { buttons: choices.map((choice, index) => ({
            type: "reply",
            reply: { id: `option-${index + 1}`, title: choice.title },
          })) },
        }
        : {
          type: "list",
          body: { text: body },
          action: {
            button: "Ver opções",
            sections: [{
              title: "Escolha um assunto",
              rows: choices.map((choice, index) => ({
                id: `option-${index + 1}`,
                title: choice.title,
                ...(choice.description ? { description: choice.description } : {}),
              })),
            }],
          },
        },
    });
  }

  /**
   * Envia um modelo (template) aprovado pela Meta.
   *
   * É o único envio possível para quem nunca escreveu para o número: fora da
   * janela de 24h desde a última mensagem da pessoa, a API oficial recusa texto
   * livre. Sem isto a prospecção ativa não teria como começar uma conversa.
   *
   * Os dois modos identificam o modelo de formas diferentes: no self-serve pelo
   * id que o painel do Gupshup mostra, no partner pelo nome registrado na Meta
   * mais o idioma. Passar o do outro modo não dá erro claro — o provedor
   * responde que não encontrou o modelo — então cada caminho exige o seu.
   */
  async sendTemplate(params: GupshupSendParams & {
    templateId?: string | null;
    templateName?: string | null;
    languageCode?: string | null;
    variables: string[];
  }): Promise<GupshupSendResult> {
    if (this.mode() === "SELF_SERVE") {
      if (!params.templateId) {
        throw new ServiceUnavailableException(
          "Cadastre o id do modelo aprovado no Gupshup para abrir conversas com números novos.",
        );
      }
      if (!params.source || !params.appName) {
        throw new ServiceUnavailableException("O canal do Gupshup está sem número de origem ou nome do aplicativo.");
      }
      // Endpoint próprio de modelo: o de mensagem comum recusa quem está fora
      // da janela de 24h, e é justamente esse o caso aqui.
      const raw = await this.performRequest(`${this.apiUrl}/wa/api/v1/template/msg`, {
        method: "POST",
        headers: { apikey: this.apiKey(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          channel: "whatsapp",
          source: normalizePhone(params.source),
          destination: brazilianMobileDestination(normalizePhone(params.to)),
          "src.name": params.appName,
          template: JSON.stringify({ id: params.templateId, params: params.variables }),
        }).toString(),
      });
      return this.readSelfServeResult(raw, params.appName);
    }

    if (!params.templateName) {
      throw new ServiceUnavailableException(
        "Cadastre o nome do modelo aprovado na Meta para abrir conversas com números novos.",
      );
    }
    return this.sendMessage(params.appId, params.appToken, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(params.to),
      type: "template",
      template: {
        name: params.templateName,
        language: { code: params.languageCode || "pt_BR" },
        components: params.variables.length
          ? [{
            type: "body",
            parameters: params.variables.map((value) => ({ type: "text", text: value })),
          }]
          : [],
      },
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
        destination: brazilianMobileDestination(normalizePhone(params.to)),
        "src.name": params.appName,
        message: JSON.stringify(message),
      }).toString(),
    });
    return this.readSelfServeResult(raw, params.appName);
  }

  /**
   * A API v1 do Gupshup responde HTTP 200 mesmo quando recusa, sinalizando o
   * problema apenas no corpo (`status: "error"`). Confiar no código HTTP fazia
   * a mensagem ser gravada como enviada sem `providerMessageId`, de modo que
   * nenhum evento de status a encontrava depois: ela ficava "enviada" para
   * sempre sem nunca ter saído.
   *
   * Vale igual para o endpoint de modelo, que é onde a recusa é mais provável:
   * modelo não aprovado, pausado pela Meta ou com número de variáveis diferente
   * do aprovado responde exatamente assim.
   */
  private readSelfServeResult(raw: any, appName?: string | null): GupshupSendResult {
    const messageId = readString(raw?.messageId);
    const status = readString(raw?.status);
    if (!messageId || (status && status.toLowerCase() !== "submitted")) {
      const detail = readString(raw?.message) ?? readString(raw?.reason) ?? status;
      this.logger.warn(
        `Gupshup aceitou a requisição mas não enviou (${appName ?? "app"}): ${JSON.stringify(raw).slice(0, 300)}`,
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
    // A resposta usa os nomes do Gupshup; traduzimos de volta para os nossos.
    return {
      addressLine1: readString(profile?.addressLine1) ?? readString(profile?.addLine1),
      addressLine2: readString(profile?.addressLine2) ?? readString(profile?.addLine2),
      city: readString(profile?.city),
      state: readString(profile?.state),
      pinCode: readString(profile?.pinCode),
      country: readString(profile?.country),
      description: readString(profile?.desc) ?? readString(profile?.description),
      email: readString(profile?.profileEmail) ?? readString(profile?.email),
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
      if (value === undefined || value === null || value === "") continue;
      const remoteName = PROFILE_FIELD_NAMES[key];
      if (!remoteName) continue;
      form[remoteName] = String(value);
    }
    if (Object.keys(form).length === 0) return;

    const result = await this.appRequest(`/app/${encodeURIComponent(params.appId)}/business/profile`, {
      method: "PUT",
      appToken: params.appToken,
      form,
    });
    this.assertGupshupAccepted(result, "atualizar o perfil");
  }

  /**
   * O Gupshup responde HTTP 200 mesmo quando recusa, sinalizando o problema só
   * no corpo. Confiar no código HTTP fazia o painel dizer "salvo" sem nada ter
   * mudado no WhatsApp.
   */
  private assertGupshupAccepted(result: any, acao: string) {
    const status = readString(result?.status);
    if (status && status.toLowerCase() !== "success" && status.toLowerCase() !== "submitted") {
      const detail = readString(result?.message) ?? status;
      this.logger.warn(`Gupshup recusou ${acao}: ${JSON.stringify(result).slice(0, 300)}`);
      throw new BadGatewayException(
        detail.length < 160 ? `O Gupshup recusou ${acao}: ${detail}` : `O Gupshup recusou ${acao}.`,
      );
    }
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
    const result = await this.performRequest(url, {
      method: "PUT",
      // multipart: o boundary é definido pelo FormData, então não fixamos
      // Content-Type aqui.
      headers: selfServe ? { apikey: this.apiKey() } : { Authorization: params.appToken },
      body,
    });
    this.assertGupshupAccepted(result, "trocar a foto do perfil");
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

/**
 * Devolve o celular brasileiro na forma que o WhatsApp usa hoje: com o nono
 * dígito.
 *
 * O webhook entrega o `wa_id` de números brasileiros antigos sem esse 9. A API
 * da Meta aceita a forma legada e resolve internamente; a v1 do Gupshup aceita,
 * responde `submitted` e a mensagem nunca é entregue — falha silenciosa que só
 * aparece como ausência de mensagem no celular do destinatário.
 *
 * A conversão é restrita à faixa de celular (local começando em 6–9). Fixos
 * brasileiros também têm oito dígitos, mas começam em 2–5, e inserir o 9 neles
 * produziria um número inexistente.
 */
export function brazilianMobileDestination(phone: string) {
  const legacyMobile = /^55(\d{2})([6-9]\d{7})$/.exec(phone);
  if (!legacyMobile) return phone;
  return `55${legacyMobile[1]}9${legacyMobile[2]}`;
}
