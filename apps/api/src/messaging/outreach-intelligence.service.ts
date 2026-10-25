import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OutreachTargetStatus } from "@prisma/client";
import { AI_PROVIDER, AIProvider } from "../ai/providers/ai-provider.interface";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { formatarTelefoneParaExibicao } from "./outreach-contacts";
import {
  GeneratedOutreachCopy, mapOutreachRows, OUTREACH_CHANNEL_KEY, OUTREACH_FIELDS,
  OUTREACH_MIN_INTERVAL_MS, OUTREACH_OUTPUT_CONTRACT, OUTREACH_PRODUCT_FACTS, OUTREACH_PROMPT_V1,
  OutreachMapping, outreachPreviewFingerprint, parseOutreachWorkbook, suggestOutreachMapping, validateOutreachCopy,
  validateOutreachMapping,
} from "./outreach-intelligence";

const REPLY_CATEGORIES = [
  "INTERESSE", "MAIS_INFORMACOES", "DEMONSTRACAO", "DUVIDA", "OBJECAO",
  "SEM_INTERESSE", "DESCADASTRO", "INCONCLUSIVA",
] as const;

function parseJsonObject(content: string | null): Record<string, unknown> {
  const cleaned = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON não é um objeto.");
  return parsed as Record<string, unknown>;
}

@Injectable()
export class OutreachIntelligenceService {
  private readonly logger = new Logger(OutreachIntelligenceService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(AI_PROVIDER) private readonly ai: AIProvider,
  ) {}

  private db() { return this.prisma as any; }

  async preview(buffer: Buffer, requestedSheet?: string, requestedMapping?: OutreachMapping) {
    let workbook;
    try { workbook = parseOutreachWorkbook(buffer); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "Planilha inválida."); }
    const options = workbook.sheets.filter((item) => item.headers.length).map((item) => ({
      name: item.name, rows: item.nonEmptyRows, headers: item.headers,
    }));
    const sheet = requestedSheet
      ? workbook.sheets.find((item) => item.name === requestedSheet)
      : workbook.sheets.find((item) => item.rows.length && validateOutreachMapping(suggestOutreachMapping(item.headers), item.headers))
        ?? workbook.sheets.find((item) => item.headers.length && item.rows.length);
    if (!sheet) throw new BadRequestException("Nenhuma aba com nome e telefone foi encontrada.");
    let mapping = requestedMapping ?? suggestOutreachMapping(sheet.headers);
    let aiMappingUsed = false;
    let mappingWarning: string | null = null;
    if (!requestedMapping && (mapping.name === undefined || mapping.phone === undefined || mapping.segment === undefined)) {
      try {
        // Custo da plataforma: mapeamento de planilha do SUPER_ADMIN, sem tenant.
        const result = await this.ai.chat([
          { role: "system", content: "Mapeie somente cabeçalhos reais da planilha de prospecção. Não invente colunas nem analise dados pessoais. Retorne JSON {mapping:{name,phone,segment,city,state,address,website,consent}}; cada valor é índice inteiro existente ou null." },
          { role: "user", content: JSON.stringify({ headers: sheet.headers, fields: OUTREACH_FIELDS }) },
        ], undefined, { responseFormat: "json_object", thinking: false, temperature: 0, maxTokens: 300 });
        const obj = parseJsonObject(result.content);
        const proposed = obj.mapping;
        if (proposed && typeof proposed === "object" && !Array.isArray(proposed)) {
          const used = new Set(Object.values(mapping));
          for (const field of OUTREACH_FIELDS) {
            const index = (proposed as Record<string, unknown>)[field];
            if (mapping[field] === undefined && Number.isInteger(index) && (index as number) >= 0
              && (index as number) < sheet.headers.length && !used.has(index as number)) {
              mapping = { ...mapping, [field]: index as number };
              used.add(index as number);
              aiMappingUsed = true;
            }
          }
        }
      } catch (error) {
        mappingWarning = "A análise assistida dos cabeçalhos falhou. Confira ou ajuste o mapeamento manualmente.";
        this.logger.warn(`Mapeamento assistido indisponível: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!validateOutreachMapping(mapping, sheet.headers)) {
      mappingWarning = "Selecione as colunas de nome e telefone antes de confirmar.";
    }
    const rows = validateOutreachMapping(mapping, sheet.headers) ? mapOutreachRows(sheet, mapping) : [];
    const seen = new Set<string>();
    let duplicated = 0;
    for (const row of rows) if (row.phone && !row.issue) {
      if (seen.has(row.phone)) duplicated++;
      seen.add(row.phone);
    }
    return {
      hash: workbook.hash, previewFingerprint: outreachPreviewFingerprint(workbook.hash, sheet.name, mapping),
      sheets: options, selectedSheet: sheet.name, mapping,
      aiMappingUsed, mappingWarning, totalRows: sheet.rows.length,
      validRows: rows.filter((row) => !row.issue).length,
      invalidRows: rows.filter((row) => row.issue).length,
      duplicatePhones: duplicated,
      unverifiedConsent: rows.filter((row) => !row.issue).length,
      samples: rows.slice(0, 30).map((row) => ({
        rowNumber: row.rowNumber, name: row.name, phone: row.phone ? formatarTelefoneParaExibicao(row.phone) : null,
        segment: row.segment, city: row.city, consent: row.consentValue || "Não verificado", issue: row.issue,
      })),
    };
  }

  async confirmImport(buffer: Buffer, input: { hash: string; previewFingerprint: string; sheet: string; name: string; mapping: OutreachMapping }, userId: string) {
    const workbook = parseOutreachWorkbook(buffer);
    if (workbook.hash !== input.hash) throw new ConflictException("A planilha mudou desde a prévia. Analise-a novamente.");
    const sheet = workbook.sheets.find((item) => item.name === input.sheet);
    if (!sheet || !validateOutreachMapping(input.mapping, sheet.headers)) throw new BadRequestException("Aba ou mapeamento inválido.");
    if (outreachPreviewFingerprint(workbook.hash, sheet.name, input.mapping) !== input.previewFingerprint)
      throw new ConflictException("O mapeamento mudou desde a prévia. Confira a planilha novamente.");
    const rows = mapOutreachRows(sheet, input.mapping);
    if (!rows.length) throw new BadRequestException("A aba escolhida não tem leads.");
    const name = input.name?.trim();
    if (!name || name.length < 3 || name.length > 120) throw new BadRequestException("Informe um nome de campanha entre 3 e 120 caracteres.");
    const channel = await this.db().platformWhatsAppChannel.upsert({
      where: { key: OUTREACH_CHANNEL_KEY },
      create: { key: OUTREACH_CHANNEL_KEY, provider: "BAILEYS", config: {}, automationEnabled: false },
      update: {},
    });
    const user = await this.db().user.findUnique({ where: { id: userId }, select: { name: true } });
    const phones = [...new Set(rows.map((row) => row.phone).filter(Boolean))];
    const [blocks, previous, customers] = await Promise.all([
      this.db().platformOutreachBlock.findMany({ where: { phone: { in: phones } }, select: { phone: true } }),
      this.db().platformOutreachTarget.findMany({ where: { phone: { in: phones }, status: { in: ["ENVIADO", "RESPONDEU"] } }, select: { phone: true } }),
      this.db().company.findMany({ select: { phone: true, whatsapp: true } }),
    ]);
    const blocked = new Set<string>(blocks.map((item: any) => item.phone));
    const contacted = new Set<string>(previous.map((item: any) => item.phone));
    const customerPhones = new Set<string>();
    const { normalizarTelefoneBrasileiro } = await import("./outreach-contacts");
    for (const customer of customers) for (const raw of [customer.phone, customer.whatsapp]) {
      const phone = raw ? normalizarTelefoneBrasileiro(raw) : null;
      if (phone) customerPhones.add(phone);
    }
    const firstByPhone = new Map<string, string>();
    const targetData: any[] = [];
    const rowData: any[] = [];
    for (const row of rows) {
      let reason = row.issue;
      let status = "INVALIDO";
      let targetId: string | null = null;
      if (!reason && row.phone) {
        if (firstByPhone.has(row.phone)) {
          reason = "telefone repetido nesta aba";
          status = "DUPLICADO";
          targetId = firstByPhone.get(row.phone)!;
        } else {
          targetId = randomUUID();
          firstByPhone.set(row.phone, targetId);
          reason = blocked.has(row.phone) ? "pediu para não receber"
            : contacted.has(row.phone) ? "já foi abordado antes"
              : customerPhones.has(row.phone) ? "já é cliente" : null;
          status = reason ? "DESCARTADO" : "VALIDO_SEM_AUTORIZACAO";
          targetData.push({
            id: targetId, phone: row.phone, name: row.name, company: row.name, city: row.city,
            segment: row.segment, address: row.address, website: row.website, sourceRowNumber: row.rowNumber,
            status: reason ? OutreachTargetStatus.DESCARTADO : OutreachTargetStatus.PENDENTE,
            discardReason: reason, consentStatus: "NAO_VERIFICADO",
          });
        }
      }
      rowData.push({
        id: randomUUID(), targetId, sheet: sheet.name, rowNumber: row.rowNumber,
        originalData: row.originalData, mappedData: {
          name: row.name, phone: row.phone, segment: row.segment, city: row.city,
          state: row.state, address: row.address, website: row.website, consentInSpreadsheet: row.consentValue,
        }, status, reason,
      });
    }
    const campaign = await this.db().$transaction(async (tx: any) => {
      const created = await tx.platformOutreachCampaign.create({ data: {
        channelId: channel.id, name, sourceType: "XLSX", importFileHash: workbook.hash,
        importSheet: sheet.name, importMapping: input.mapping, createdByUserId: userId,
        createdByName: user?.name ?? null, totalTargets: targetData.length,
        minIntervalSeconds: 60, maxIntervalSeconds: 60, dailyLimit: 200,
      } });
      for (let index = 0; index < targetData.length; index += 250) {
        await tx.platformOutreachTarget.createMany({ data: targetData.slice(index, index + 250).map((item) => ({ ...item, campaignId: created.id })) });
      }
      for (let index = 0; index < rowData.length; index += 250) {
        await tx.platformOutreachImportRow.createMany({ data: rowData.slice(index, index + 250).map((item) => ({ ...item, campaignId: created.id })) });
      }
      return created;
    }, { timeout: 30_000 });
    return { campaignId: campaign.id, totalRows: rows.length, uniqueTargets: targetData.length,
      invalidRows: rowData.filter((row) => row.status === "INVALIDO").length,
      duplicateRows: rowData.filter((row) => row.status === "DUPLICADO").length,
      excludedRows: rowData.filter((row) => row.status === "DESCARTADO").length,
      authorizationPending: targetData.filter((item) => item.status === OutreachTargetStatus.PENDENTE).length };
  }

  async prompt() {
    const latest = await this.db().platformOutreachPrompt.findFirst({ orderBy: { version: "desc" } });
    return latest ?? { version: 1, systemPrompt: OUTREACH_PROMPT_V1, createdAt: null };
  }

  async updatePrompt(content: string, userId: string) {
    const systemPrompt = typeof content === "string" ? content.trim() : "";
    if (!systemPrompt) throw new BadRequestException("Informe o texto do prompt de copywriting.");
    const current = await this.prompt();
    return this.db().platformOutreachPrompt.create({ data: {
      version: current.version + 1, systemPrompt, createdByUserId: userId,
    } });
  }

  async listTargets(campaignId: string, page = 1) {
    await this.requireCampaign(campaignId);
    const take = 50;
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 200) : 1;
    const [total, targets] = await Promise.all([
      this.db().platformOutreachTarget.count({ where: { campaignId } }),
      this.db().platformOutreachTarget.findMany({ where: { campaignId }, orderBy: { sourceRowNumber: "asc" }, skip: (safePage - 1) * take, take,
        include: { attempt: true } }),
    ]);
    return { total, page: safePage, pageSize: take, targets: targets.map((target: any) => ({
      ...target, phoneFormatted: formatarTelefoneParaExibicao(target.phone),
    })) };
  }

  async listImportRows(campaignId: string, page = 1) {
    await this.requireCampaign(campaignId);
    const take = 50;
    const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, 200) : 1;
    const where = { campaignId, status: { not: "VALIDO_SEM_AUTORIZACAO" } };
    const [total, rows] = await Promise.all([
      this.db().platformOutreachImportRow.count({ where }),
      this.db().platformOutreachImportRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (safePage - 1) * take, take }),
    ]);
    return { total, page: safePage, pageSize: take, rows };
  }

  private async requireCampaign(id: string) {
    const campaign = await this.db().platformOutreachCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campanha não encontrada.");
    return campaign;
  }

  async requestGeneration(campaignId: string) {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.sourceType !== "XLSX" || campaign.status !== "RASCUNHO") throw new BadRequestException("Apenas campanhas XLSX em rascunho podem preparar mensagens.");
    const prompt = await this.prompt();
    const pending = await this.db().platformOutreachTarget.count({ where: {
      campaignId, status: OutreachTargetStatus.PENDENTE,
    } });
    if (!pending) throw new BadRequestException("Esta campanha não possui leads aptos para preparar.");
    await this.db().platformOutreachTarget.updateMany({ where: {
      campaignId, status: OutreachTargetStatus.PENDENTE,
      generationStatus: { in: ["NAO_PREPARADO", "REVISAO"] },
    }, data: { generationStatus: "PENDENTE", generationAttempts: 0,
      approvalStatus: "PENDENTE", errorMessage: null } });
    await this.db().platformOutreachCampaign.update({ where: { id: campaignId }, data: {
      promptVersion: prompt.version, preparationRequestedAt: new Date(), approvedAt: null,
    } });
    return { queued: pending, promptVersion: prompt.version };
  }

  /** Um item por giro, em fila persistida; falha de IA nunca vira mensagem enviada. */
  async prepareNext() {
    const stale = new Date(Date.now() - 2 * 60_000);
    const interrupted = await this.db().platformOutreachTarget.findMany({ where: {
      generationStatus: "EM_PREPARO", generationStartedAt: { lt: stale },
    }, take: 20, select: { id: true, generationAttempts: true } });
    for (const item of interrupted) await this.db().platformOutreachTarget.updateMany({
      where: { id: item.id, generationStatus: "EM_PREPARO" }, data: {
        generationStatus: item.generationAttempts >= 2 ? "REVISAO" : "PENDENTE",
        errorMessage: "Preparação interrompida; retomada com segurança.",
      },
    });
    const campaign = await this.db().platformOutreachCampaign.findFirst({
      where: { preparationRequestedAt: { not: null }, status: "RASCUNHO" }, orderBy: { preparationRequestedAt: "asc" },
    });
    if (!campaign) return;
    const target = await this.db().platformOutreachTarget.findFirst({ where: {
      campaignId: campaign.id, status: OutreachTargetStatus.PENDENTE, generationStatus: "PENDENTE",
    }, orderBy: { sourceRowNumber: "asc" } });
    if (!target) {
      await this.db().platformOutreachCampaign.update({ where: { id: campaign.id }, data: { preparationRequestedAt: null } });
      return;
    }
    const claim = await this.db().platformOutreachTarget.updateMany({ where: {
      id: target.id, generationStatus: "PENDENTE", generationAttempts: target.generationAttempts,
    }, data: { generationStatus: "EM_PREPARO", generationStartedAt: new Date(), generationAttempts: { increment: 1 } } });
    if (claim.count !== 1) return;
    let requestId: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const version = campaign.promptVersion ?? 1;
      const prompt = version === 1 ? OUTREACH_PROMPT_V1
        : (await this.db().platformOutreachPrompt.findUnique({ where: { version } }))?.systemPrompt;
      if (!prompt) throw new Error("Versão do prompt não encontrada.");
      const availableFields = [
        ...(target.name ? ["nome"] : []),
        ...(target.segment ? ["segmento"] : []),
        ...(target.city ? ["cidade"] : []),
      ];
      const retryInstruction = target.generationAttempts > 0
        ? "A resposta anterior não passou na validação. Esta é a última tentativa: confira especialmente o tamanho do benefício, o tamanho da proposta, os campos usados e a ausência de placeholders."
        : "";
      // Custo da plataforma: copy comercial gerada pelo SUPER_ADMIN. Tokens
      // ficam registrados no alvo para auditoria e controle de despesas.
      const result = await this.ai.chat([
        { role: "system", content: `${prompt}\n${OUTREACH_OUTPUT_CONTRACT}${retryInstruction ? `\n${retryInstruction}` : ""}` },
        { role: "user", content: JSON.stringify({ leadId: target.id, estabelecimento: target.name,
          segmento: target.segment, cidade: target.city, funcionalidadesComprovadas: OUTREACH_PRODUCT_FACTS,
          camposDisponiveis: availableFields,
          formato: { beneficioPrincipal: "rótulo curto, 4-80 caracteres", proposta: "mensagem completa, 50-450 caracteres, sem placeholders",
            dadosUtilizados: "array dos campos disponíveis realmente usados", alertas: [] } }) },
      ], undefined, { responseFormat: "json_object", thinking: false, temperature: 0.35, maxTokens: 450 });
      requestId = result.requestId ?? null;
      inputTokens = result.usage?.inputTokens ?? 0;
      outputTokens = result.usage?.outputTokens ?? 0;
      const copy = validateOutreachCopy(parseJsonObject(result.content), {
        name: target.name ?? "", segment: target.segment, city: target.city,
      });
      const messageText = copy.proposta;
      await this.db().platformOutreachTarget.update({ where: { id: target.id }, data: {
        generationStatus: "PRONTO", proposal: copy.proposta, messageText,
        mainBenefit: copy.beneficioPrincipal, aiDataUsed: copy.dadosUtilizados, aiAlerts: copy.alertas,
        aiRequestId: requestId, aiInputTokens: (target.aiInputTokens ?? 0) + inputTokens,
        aiOutputTokens: (target.aiOutputTokens ?? 0) + outputTokens,
        approvalStatus: "PENDENTE", errorMessage: null,
      } });
    } catch (error) {
      const attempts = target.generationAttempts + 1;
      await this.db().platformOutreachTarget.update({ where: { id: target.id }, data: {
        generationStatus: attempts >= 2 ? "REVISAO" : "PENDENTE",
        errorMessage: `Preparação da mensagem: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
        ...(requestId ? { aiRequestId: requestId } : {}),
        aiInputTokens: (target.aiInputTokens ?? 0) + inputTokens,
        aiOutputTokens: (target.aiOutputTokens ?? 0) + outputTokens,
      } });
      this.logger.warn(`Mensagem do alvo ${target.id} exige ${attempts >= 2 ? "revisão" : "nova tentativa"}.`);
    }
  }

  async regenerate(targetId: string) {
    const target = await this.requireTarget(targetId);
    if (target.campaign.status !== "RASCUNHO" || target.status !== OutreachTargetStatus.PENDENTE)
      throw new BadRequestException("Somente leads em rascunho podem ser regenerados.");
    await this.db().platformOutreachTarget.update({ where: { id: targetId }, data: {
      generationStatus: "PENDENTE", generationAttempts: 0, approvalStatus: "PENDENTE",
      approvedAt: null, approvedByUserId: null, messageText: null, proposal: null,
      mainBenefit: null, errorMessage: null,
    } });
    await this.db().platformOutreachCampaign.update({ where: { id: target.campaignId }, data: {
      preparationRequestedAt: new Date(), approvedAt: null,
    } });
    return { queued: true };
  }

  private async requireTarget(id: string) {
    const target = await this.db().platformOutreachTarget.findUnique({ where: { id }, include: { campaign: true } });
    if (!target) throw new NotFoundException("Lead não encontrado.");
    return target;
  }

  async updateConsent(id: string, data: { status: string; source?: string; evidence?: string; at?: string }) {
    const target = await this.requireTarget(id);
    if (target.campaign.status !== "RASCUNHO" && target.campaign.status !== "PAUSADA")
      throw new BadRequestException("Pause a campanha antes de alterar a autorização.");
    if (!["NAO_VERIFICADO", "CONFIRMADO", "NEGADO"].includes(data.status)) throw new BadRequestException("Situação de autorização inválida.");
    let at: Date | null = null;
    if (data.status === "CONFIRMADO") {
      at = new Date(data.at ?? "");
      if (!Number.isFinite(at.getTime()) || at > new Date() || !data.source?.trim() || data.source.trim().length < 3
        || !data.evidence?.trim() || data.evidence.trim().length < 12) {
        throw new BadRequestException("Informe origem, evidência verificável e data da autorização anterior ao envio.");
      }
    }
    if (data.status === "NEGADO") {
      await this.db().platformOutreachBlock.upsert({ where: { phone: target.phone },
        create: { phone: target.phone, reason: "autorização negada" }, update: { reason: "autorização negada" } });
      await this.db().platformOutreachTarget.updateMany({ where: { phone: target.phone, status: OutreachTargetStatus.PENDENTE },
        data: { status: OutreachTargetStatus.DESCARTADO, discardReason: "autorização negada", consentStatus: "NEGADO" } });
    } else {
      await this.db().platformOutreachTarget.update({ where: { id }, data: {
        consentStatus: data.status, consentSource: at ? data.source!.trim().slice(0, 191) : null,
        consentEvidence: at ? data.evidence!.trim().slice(0, 1000) : null, consentAt: at,
      } });
    }
    await this.db().platformOutreachCampaign.update({ where: { id: target.campaignId }, data: { approvedAt: null } });
    return { id, consentStatus: data.status };
  }

  async editProposal(id: string, proposal: string) {
    const target = await this.requireTarget(id);
    if (target.campaign.status !== "RASCUNHO" || target.status !== OutreachTargetStatus.PENDENTE)
      throw new BadRequestException("Somente leads em rascunho podem ser editados.");
    const copy: GeneratedOutreachCopy = validateOutreachCopy({
      beneficioPrincipal: target.mainBenefit || "Proposta revisada manualmente",
      proposta: String(proposal ?? ""), dadosUtilizados: [], alertas: [],
    }, { name: target.name ?? "", segment: target.segment, city: target.city });
    const messageText = copy.proposta;
    await this.db().platformOutreachCampaign.update({ where: { id: target.campaignId }, data: { approvedAt: null } });
    return this.db().platformOutreachTarget.update({ where: { id }, data: {
      proposal: copy.proposta, messageText, generationStatus: "PRONTO", approvalStatus: "PENDENTE",
      approvedAt: null, approvedByUserId: null,
    } });
  }

  async reviewTarget(id: string, approved: boolean, userId: string) {
    const target = await this.requireTarget(id);
    if (target.campaign.status !== "RASCUNHO") throw new BadRequestException("Campanha não está em rascunho.");
    if (target.status !== OutreachTargetStatus.PENDENTE || (approved && (target.generationStatus !== "PRONTO" || !target.messageText)))
      throw new BadRequestException("Mensagem ainda não validada ou lead excluído.");
    await this.db().platformOutreachCampaign.update({ where: { id: target.campaignId }, data: { approvedAt: null } });
    return this.db().platformOutreachTarget.update({ where: { id }, data: {
      approvalStatus: approved ? "APROVADO" : "REJEITADO",
      approvedAt: approved ? new Date() : null, approvedByUserId: approved ? userId : null,
    } });
  }

  async approveBatch(campaignId: string, ids: string[], userId: string) {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.status !== "RASCUNHO" || !Array.isArray(ids) || ids.length < 1 || ids.length > 500
      || ids.some((id) => typeof id !== "string")) throw new BadRequestException("Selecione de 1 a 500 mensagens em rascunho.");
    const unique = [...new Set(ids)];
    const targets = await this.db().platformOutreachTarget.findMany({ where: { id: { in: unique }, campaignId,
      status: OutreachTargetStatus.PENDENTE, generationStatus: "PRONTO", messageText: { not: null } } });
    if (targets.length !== unique.length) throw new BadRequestException("Alguma mensagem não está validada ou pertence a outra campanha.");
    await this.db().platformOutreachCampaign.update({ where: { id: campaignId }, data: { approvedAt: null } });
    await this.db().platformOutreachTarget.updateMany({ where: { id: { in: unique }, campaignId }, data: {
      approvalStatus: "APROVADO", approvedAt: new Date(), approvedByUserId: userId,
    } });
    return { approved: unique.length };
  }

  async excludeTarget(id: string) {
    const target = await this.requireTarget(id);
    if (target.campaign.status !== "RASCUNHO" || target.status !== OutreachTargetStatus.PENDENTE)
      throw new BadRequestException("Somente leads ainda não enviados podem ser excluídos.");
    await this.db().platformOutreachCampaign.update({ where: { id: target.campaignId }, data: { approvedAt: null } });
    return this.db().platformOutreachTarget.update({ where: { id }, data: {
      status: OutreachTargetStatus.DESCARTADO, discardReason: "excluído da campanha pelo administrador",
    } });
  }

  async simulate(campaignId: string) {
    const campaign = await this.requireCampaign(campaignId);
    const [targets, usage] = await Promise.all([
      this.db().platformOutreachTarget.findMany({ where: { campaignId, status: OutreachTargetStatus.PENDENTE },
      select: { consentStatus: true, generationStatus: true, approvalStatus: true, messageText: true } }),
      this.db().platformOutreachTarget.aggregate({ where: { campaignId }, _sum: { aiInputTokens: true, aiOutputTokens: true } }),
    ]);
    const pendingConsent = targets.filter((item: any) => item.consentStatus !== "CONFIRMADO").length;
    const pendingCopy = targets.filter((item: any) => item.generationStatus !== "PRONTO" || !item.messageText).length;
    const pendingApproval = targets.filter((item: any) => item.approvalStatus !== "APROVADO").length;
    const ready = targets.filter((item: any) => item.consentStatus === "CONFIRMADO" && item.generationStatus === "PRONTO"
      && item.messageText && item.approvalStatus === "APROVADO").length;
    return { campaignId, total: targets.length, ready, pendingConsent, pendingCopy, pendingApproval,
      simulated: true, sent: 0, earliestDurationMinutes: ready > 0 ? ready - 1 : 0,
      approvedCampaign: Boolean(campaign.approvedAt),
      aiInputTokens: usage._sum.aiInputTokens ?? 0, aiOutputTokens: usage._sum.aiOutputTokens ?? 0 };
  }

  async approveCampaign(campaignId: string, userId: string) {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.sourceType !== "XLSX" || campaign.status !== "RASCUNHO" || campaign.preparationRequestedAt)
      throw new BadRequestException("A preparação precisa terminar antes da aprovação.");
    const check = await this.simulate(campaignId);
    if (!check.ready || check.pendingConsent || check.pendingCopy || check.pendingApproval)
      throw new BadRequestException("Há leads sem autorização comprovada ou mensagens não validadas/aprovadas. Exclua os impedidos ou conclua a revisão.");
    await this.db().platformOutreachCampaign.update({ where: { id: campaignId }, data: {
      approvedAt: new Date(), approvedByUserId: userId,
      minIntervalSeconds: Math.max(campaign.minIntervalSeconds, OUTREACH_MIN_INTERVAL_MS / 1000),
      maxIntervalSeconds: Math.max(campaign.maxIntervalSeconds, OUTREACH_MIN_INTERVAL_MS / 1000),
    } });
    return { approved: true, ready: check.ready };
  }

  async classifyNext() {
    const stale = new Date(Date.now() - 2 * 60_000);
    await this.db().platformOutreachTarget.updateMany({ where: {
      status: OutreachTargetStatus.RESPONDEU, responseCategory: "EM_CLASSIFICACAO",
      responseClassifiedAt: { lt: stale }, classificationAttempts: { lt: 2 },
    }, data: { responseCategory: null, responseClassifiedAt: null } });
    await this.db().platformOutreachTarget.updateMany({ where: {
      status: OutreachTargetStatus.RESPONDEU, responseCategory: "EM_CLASSIFICACAO",
      responseClassifiedAt: { lt: stale }, classificationAttempts: { gte: 2 },
    }, data: { responseCategory: "INCONCLUSIVA", responseClassifiedAt: new Date() } });
    await this.db().platformOutreachTarget.updateMany({ where: {
      status: OutreachTargetStatus.RESPONDEU, responseText: { not: null }, responseCategory: null,
      classificationAttempts: { gte: 2 },
    }, data: { responseCategory: "INCONCLUSIVA", responseClassifiedAt: new Date() } });
    const target = await this.db().platformOutreachTarget.findFirst({ where: {
      status: OutreachTargetStatus.RESPONDEU, responseText: { not: null }, responseCategory: null,
      classificationAttempts: { lt: 2 },
    }, orderBy: { repliedAt: "asc" } });
    if (!target) return;
    const claim = await this.db().platformOutreachTarget.updateMany({ where: {
      id: target.id, responseCategory: null, classificationAttempts: target.classificationAttempts,
    }, data: { responseCategory: "EM_CLASSIFICACAO", responseClassifiedAt: new Date(),
      classificationAttempts: { increment: 1 } } });
    if (claim.count !== 1) return;
    try {
      // Custo da plataforma: classificação de resposta da prospecção própria.
      const result = await this.ai.chat([
        { role: "system", content: `Classifique a resposta comercial em uma destas categorias: ${REPLY_CATEGORIES.join(", ")}. Sugira resposta curta somente para revisão humana; não envie nada. JSON {categoria, respostaSugerida}. Pedidos para parar são DESCADASTRO.` },
        { role: "user", content: JSON.stringify({ resposta: String(target.responseText).slice(0, 1000), segmento: target.segment }) },
      ], undefined, { responseFormat: "json_object", thinking: false, temperature: 0, maxTokens: 220 });
      const data = parseJsonObject(result.content);
      if (!REPLY_CATEGORIES.includes(data.categoria as typeof REPLY_CATEGORIES[number])
        || typeof data.respostaSugerida !== "string" || data.respostaSugerida.length > 500) throw new Error("Classificação inválida.");
      await this.db().platformOutreachTarget.update({ where: { id: target.id }, data: {
        responseCategory: data.categoria, responseSuggestion: data.respostaSugerida,
        responseClassifiedAt: new Date(),
      } });
    } catch (error) {
      if (target.classificationAttempts + 1 >= 2) await this.db().platformOutreachTarget.update({ where: { id: target.id }, data: {
        responseCategory: "INCONCLUSIVA", responseClassifiedAt: new Date(),
      } });
      else await this.db().platformOutreachTarget.update({ where: { id: target.id }, data: {
        responseCategory: null, responseClassifiedAt: null,
      } });
      this.logger.warn(`Classificação de resposta ${target.id} falhou: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
