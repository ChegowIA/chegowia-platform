import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import {
  OutreachCampaignStatus,
  OutreachTargetStatus,
  UsageMetric,
  WhatsAppConversationMode,
} from "@prisma/client";
import { runsBackgroundJobs } from "../common/config/app-role";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { OutreachIntelligenceService } from "./outreach-intelligence.service";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";
import { OUTREACH_MIN_INTERVAL_MS } from "./outreach-intelligence";
import { PLATFORM_CHANNEL_KEY } from "./outreach-template";
import { CreateOutreachCampaignDto } from "./dto/create-outreach-campaign.dto";
import { BlockOutreachPhoneDto } from "./dto/block-outreach-phone.dto";
import {
  formatarTelefoneParaExibicao,
  lerListaDeContatos,
  normalizarTelefoneBrasileiro,
} from "./outreach-contacts";

/** Quantos exemplos de recusa e descarte a conferência devolve. */
const LIMITE_DE_EXEMPLOS = 50;

/** Quantos contatos o detalhe do disparo carrega de uma vez. */
const LIMITE_DE_ALVOS_NO_DETALHE = 500;

/** De quanto em quanto tempo o processo olha se há envio vencido. */
const INTERVALO_DO_WORKER_MS = 10_000;

/**
 * Quanto esperar quando um limite de volume trava o envio.
 *
 * A janela é rolante, então em algum ponto os envios mais antigos saem da conta
 * e a fila volta a andar sozinha. Reconferir de 15 em 15 minutos custa uma
 * consulta e evita o worker girar a cada 10 segundos batendo no mesmo limite.
 */
const ESPERA_APOS_TETO_MS = 15 * 60 * 1000;

/**
 * Teto de conversas iniciadas por nós em 24h, somando todos os disparos.
 *
 * Limite operacional conservador, independente dos limites do WhatsApp.
 * O limite por campanha não protege o remetente: três campanhas somam volume.
 */
function tetoDiarioDoNumero() {
  const configurado = Number(process.env.WHATSAPP_OUTREACH_DAILY_CAP ?? "");
  return Number.isFinite(configurado) && configurado > 0 ? Math.floor(configurado) : 250;
}

type Contato = { phone: string; name: string | null; city: string | null };

/**
 * Fila de prospecção pelo número QR isolado da Gupshup operacional.
 * Envio apenas após consentimento, revisão e aprovação individual.
 */
@Injectable()
export class PlatformOutreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformOutreachService.name);
  private timer?: NodeJS.Timeout;
  private intelligenceTimer?: NodeJS.Timeout;
  private processando = false;
  private preparando = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Optional() private readonly realtime: RealtimeGateway,
    @Optional() private readonly intelligence?: OutreachIntelligenceService,
    @Optional() private readonly whatsapp?: PlatformWhatsAppService,
  ) {}

  onModuleInit() {
    // Roda com os demais jobs. A trava persistente do remetente ainda protege
    // contra duas instâncias girando a mesma fila.
    if (!runsBackgroundJobs()) return;
    this.timer = setInterval(() => void this.processarDisparos(), INTERVALO_DO_WORKER_MS);
    this.intelligenceTimer = setInterval(() => void this.processarInteligencia(), INTERVALO_DO_WORKER_MS);
    void this.processarDisparos();
    void this.processarInteligencia();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.intelligenceTimer) clearInterval(this.intelligenceTimer);
  }

  private async processarInteligencia() {
    if (this.preparando || !this.intelligence) return;
    this.preparando = true;
    try {
      await this.intelligence.prepareNext();
      await this.intelligence.classifyNext();
    } catch (error) {
      this.logger.error(`Fila de inteligência: ${error instanceof Error ? error.message : String(error)}`);
    } finally { this.preparando = false; }
  }

  private db() {
    return this.prisma as any;
  }

  // ---------------------------------------------------------------------------
  // Leitura da lista
  // ---------------------------------------------------------------------------

  /**
   * Confere a lista sem criar nada.
   *
   * Existe porque colar 400 números e descobrir depois que 300 estavam repetidos
   * é o tipo de coisa que se quer saber antes, não no relatório do disparo.
   */
  async analisarLista(bruto: string) {
    const leitura = lerListaDeContatos(bruto);
    const descartes = await this.classificarDescartes(leitura.contatos);
    const aptos = leitura.contatos.filter((contato) => !descartes.has(contato.phone));
    return {
      total: leitura.contatos.length,
      aptos: aptos.length,
      /**
       * Como os primeiros contatos foram entendidos.
       *
       * Nenhuma heurística acerta todo rótulo: "liguei pro 62999998888 ontem"
       * deixa a frase no lugar do nome e pode contaminar a mensagem gerada.
       * Mostrar a leitura antes do disparo resolve o que adivinhar não
       * resolve — quem colou reconhece o absurdo em um olhar.
       */
      amostra: aptos.slice(0, 10).map((contato) => ({
        phone: formatarTelefoneParaExibicao(contato.phone),
        name: contato.name,
        city: contato.city,
      })),
      repetidosNaLista: leitura.repetidos,
      // Listas de 2 mil números geram 2 mil descartes, e mandar tudo isso para a
      // tela só engorda a resposta. O total vem separado para o corte aparecer
      // em vez de parecer que só existem esses.
      recusados: leitura.recusados.slice(0, LIMITE_DE_EXEMPLOS),
      recusadosTotal: leitura.recusados.length,
      possiveisFixos: leitura.possiveisFixos.slice(0, LIMITE_DE_EXEMPLOS).map(formatarTelefoneParaExibicao),
      possiveisFixosTotal: leitura.possiveisFixos.length,
      descartados: [...descartes.entries()].slice(0, LIMITE_DE_EXEMPLOS).map(([phone, motivo]) => ({
        phone: formatarTelefoneParaExibicao(phone),
        motivo,
      })),
      descartadosTotal: descartes.size,
    };
  }

  /**
   * Quem não deve receber, e por quê.
   *
   * São quatro casos, e cada um por um motivo diferente: pedido de não receber,
   * conversa que já existe (reabordar quem já falou com a gente é o que mais
   * irrita), número já usado em outro disparo e número de empresa que já é
   * cliente — oferecer a plataforma para quem já paga por ela queima o contato.
   */
  private async classificarDescartes(contatos: Contato[]) {
    const motivos = new Map<string, string>();
    if (!contatos.length) return motivos;
    const numeros = contatos.map((contato) => contato.phone);

    const [bloqueios, conversas, alvosAnteriores, empresas] = await Promise.all([
      this.db().platformOutreachBlock.findMany({
        where: { phone: { in: numeros } },
        select: { phone: true },
      }),
      this.db().platformWhatsAppConversation.findMany({
        where: { customerPhone: { in: numeros } },
        select: { customerPhone: true, lastMessageText: true, lastInboundAt: true },
      }),
      // Alvo que falhou não conta: se contasse, uma queda do provedor deixaria
      // aqueles números inalcançáveis para sempre, porque a lista nova os
      // descartaria como "já entrou em outro disparo".
      this.db().platformOutreachTarget.findMany({
        where: { phone: { in: numeros }, status: { not: OutreachTargetStatus.FALHOU } },
        select: { phone: true },
      }),
      // Telefone de empresa é campo livre, então a comparação precisa ser feita
      // normalizada. A tabela é pequena o suficiente para varrer; se um dia não
      // for, o caminho é guardar a versão normalizada na própria empresa.
      this.db().company.findMany({
        select: { phone: true, whatsapp: true },
      }),
    ]);

    for (const { phone } of bloqueios) motivos.set(phone, "pediu para não receber");
    for (const conversa of conversas) {
      // Conversa que existe só porque uma tentativa falhou não é conversa: nada
      // foi entregue e ninguém respondeu. Tratá-la como conversa real também
      // deixava o número inalcançável depois de um erro de configuração.
      const houveContato = Boolean(conversa.lastMessageText || conversa.lastInboundAt);
      if (houveContato && !motivos.has(conversa.customerPhone)) {
        motivos.set(conversa.customerPhone, "já existe conversa com este número");
      }
    }
    for (const { phone } of alvosAnteriores) {
      if (!motivos.has(phone)) motivos.set(phone, "já entrou em outro disparo");
    }
    const deClientes = new Set<string>();
    for (const empresa of empresas) {
      for (const bruto of [empresa.phone, empresa.whatsapp]) {
        const normalizado = bruto ? normalizarTelefoneBrasileiro(bruto) : null;
        if (normalizado) deClientes.add(normalizado);
      }
    }
    for (const numero of numeros) {
      if (deClientes.has(numero) && !motivos.has(numero)) {
        motivos.set(numero, "número de uma empresa que já é cliente");
      }
    }
    return motivos;
  }

  // ---------------------------------------------------------------------------
  // Campanhas
  // ---------------------------------------------------------------------------

  async criarCampanha(_userId: string, _dto: CreateOutreachCampaignDto) {
    throw new BadRequestException("Use a importação XLSX da Central de Prospecção. Listas coladas não comprovam autorização para contato.");
  }
  async listarCampanhas() {
    const campanhas = await this.db().platformOutreachCampaign.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const ids = campanhas.map((campanha: any) => campanha.id);
    const [pendentes, custosDeIa] = await Promise.all([this.pendentesPorCampanha(ids), this.custoDeIaPorCampanha(ids)]);
    return campanhas.map((campanha: any) => this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0, custosDeIa.get(campanha.id) ?? 0));
  }

  /**
   * Quantos contatos ainda vão receber, contados no banco.
   *
   * Subtrair enviados e falhos do total dava número errado assim que alguém
   * pedia para não receber: os pendentes daquele número viram descartados, e a
   * campanha aparecia com fila cheia depois de já ter acabado.
   */
  /**
   * Resumo com a fila conferida no banco.
   *
   * As ações (começar, pausar, cancelar) devolvem o disparo para a tela pintar
   * na hora. Sem passar pela contagem real, cancelar respondia com a fila antiga
   * — dois contatos "na fila" que acabavam de virar descartados.
   */
  private async resumoComFila(campanha: any) {
    const [pendentes, custosDeIa] = await Promise.all([
      this.pendentesPorCampanha([campanha.id]), this.custoDeIaPorCampanha([campanha.id]),
    ]);
    return this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0, custosDeIa.get(campanha.id) ?? 0);
  }

  /**
   * Custo da IA que preencheu as variáveis, pelos tokens guardados em cada lead
   * e pela tarifa de custo da DeepSeek. Entra no gasto da campanha junto com as
   * mensagens.
   */
  private async custoDeIaPorCampanha(ids: string[]) {
    const mapa = new Map<string, number>();
    if (!ids.length) return mapa;
    const [grupos, tarifas] = await Promise.all([
      this.db().platformOutreachTarget.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: ids } },
        _sum: { aiInputTokens: true, aiOutputTokens: true },
      }),
      this.db().usageRate.findMany({ where: { metric: { in: [UsageMetric.IA_TOKENS_ENTRADA, UsageMetric.IA_TOKENS_SAIDA] } } }),
    ]);
    const porToken = (metric: UsageMetric) => {
      const tarifa = tarifas.find((item: any) => item.metric === metric);
      return tarifa ? Number(tarifa.providerUnitCost) / Math.max(Number(tarifa.unitSize) || 1, 0.000001) : 0;
    };
    const entrada = porToken(UsageMetric.IA_TOKENS_ENTRADA);
    const saida = porToken(UsageMetric.IA_TOKENS_SAIDA);
    for (const grupo of grupos) {
      mapa.set(grupo.campaignId, (grupo._sum.aiInputTokens ?? 0) * entrada + (grupo._sum.aiOutputTokens ?? 0) * saida);
    }
    return mapa;
  }

  /** Gasto total da campanha: mensagens já enviadas mais a IA que as preparou. */
  private async gastoDaCampanha(campanha: any) {
    const ia = (await this.custoDeIaPorCampanha([campanha.id])).get(campanha.id) ?? 0;
    return Number(campanha.spentAmount ?? 0) + ia;
  }

  /** Teto alcançado: nenhum envio novo sai enquanto o teto não subir. */
  private async tetoDeGastoAlcancado(campanha: any) {
    if (campanha.spendLimit === null || campanha.spendLimit === undefined) return null;
    const limite = Number(campanha.spendLimit);
    const gasto = await this.gastoDaCampanha(campanha);
    return gasto >= limite ? { limite, gasto } : null;
  }

  /** Define ou remove o teto de gasto; vale também com a campanha enviando. */
  async definirTetoDeGasto(id: string, valor: unknown) {
    const campanha = await this.buscarCampanha(id);
    if (campanha.status === OutreachCampaignStatus.CONCLUIDA || campanha.status === OutreachCampaignStatus.CANCELADA) {
      throw new BadRequestException("Este disparo já foi encerrado.");
    }
    let spendLimit: number | null = null;
    if (valor !== null && valor !== undefined && valor !== "") {
      spendLimit = Math.round(Number(valor) * 100) / 100;
      if (!Number.isFinite(spendLimit) || spendLimit < 1 || spendLimit > 1_000_000) {
        throw new BadRequestException("Informe um teto entre R$ 1,00 e R$ 1.000.000,00, ou deixe vazio para não limitar.");
      }
    }
    const atualizada = await this.db().platformOutreachCampaign.update({ where: { id }, data: { spendLimit } });
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(atualizada);
  }

  private async pendentesPorCampanha(ids: string[]) {
    const mapa = new Map<string, number>();
    if (!ids.length) return mapa;
    const grupos = await this.db().platformOutreachTarget.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: ids }, status: OutreachTargetStatus.PENDENTE },
      _count: { _all: true },
    });
    for (const grupo of grupos) mapa.set(grupo.campaignId, grupo._count._all);
    return mapa;
  }

  async detalharCampanha(id: string) {
    const campanha = await this.db().platformOutreachCampaign.findUnique({
      where: { id },
      include: {
        targets: {
          // Quem respondeu primeiro, depois o que saiu mais recente. Ordenar por
          // status punha os pendentes na frente, e num disparo de 2 mil contatos
          // as 500 linhas carregadas eram todas "na fila" — justamente as que não
          // têm nada para contar. Em MySQL, DESC já joga o nulo para o fim.
          orderBy: [{ repliedAt: "desc" }, { sentAt: "desc" }, { createdAt: "asc" }],
          take: LIMITE_DE_ALVOS_NO_DETALHE,
          select: {
            id: true,
            phone: true,
            name: true,
            city: true,
            status: true,
            sentAt: true,
            repliedAt: true,
            errorMessage: true,
            discardReason: true,
            conversationId: true,
          },
        },
      },
    });
    if (!campanha) throw new NotFoundException("Disparo não encontrado.");
    const [pendentes, custosDeIa] = await Promise.all([
      this.pendentesPorCampanha([campanha.id]), this.custoDeIaPorCampanha([campanha.id]),
    ]);
    // O total dos contatos carregados sai junto: uma lista de 2 mil aparecia
    // cortada em 500 sem nada dizendo que havia mais.
    const alvosNoTotal = await this.db().platformOutreachTarget.count({
      where: { campaignId: campanha.id },
    });
    return {
      ...this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0, custosDeIa.get(campanha.id) ?? 0),
      targetsTotal: alvosNoTotal,
      targets: campanha.targets.map((alvo: any) => ({
        ...alvo,
        phoneFormatted: formatarTelefoneParaExibicao(alvo.phone),
      })),
    };
  }

  private resumoDaCampanha(campanha: any, pendentes?: number, custoDeIa = 0) {
    const gastoComMensagens = Number(campanha.spentAmount ?? 0);
    return {
      id: campanha.id,
      name: campanha.name,
      status: campanha.status,
      totalTargets: campanha.totalTargets,
      sentCount: campanha.sentCount,
      repliedCount: campanha.repliedCount,
      failedCount: campanha.failedCount,
      pendingCount: pendentes ?? Math.max(campanha.totalTargets - campanha.sentCount - campanha.failedCount, 0),
      dailyLimit: campanha.dailyLimit,
      minIntervalSeconds: campanha.minIntervalSeconds,
      maxIntervalSeconds: campanha.maxIntervalSeconds,
      respectBusinessHours: campanha.respectBusinessHours,
      nextSendAt: campanha.nextSendAt,
      pausedReason: campanha.pausedReason,
      spendLimit: campanha.spendLimit === null || campanha.spendLimit === undefined ? null : Number(campanha.spendLimit),
      spentMessages: arredondarCentavos(gastoComMensagens),
      spentAi: arredondarCentavos(custoDeIa),
      spentTotal: arredondarCentavos(gastoComMensagens + custoDeIa),
      sourceType: campanha.sourceType,
      approvedAt: campanha.approvedAt,
      preparationRequestedAt: campanha.preparationRequestedAt,
      promptVersion: campanha.promptVersion,
      createdByName: campanha.createdByName,
      startedAt: campanha.startedAt,
      completedAt: campanha.completedAt,
      createdAt: campanha.createdAt,
    };
  }

  async iniciar(id: string) {
    const campanha = await this.buscarCampanha(id);
    if (campanha.status === OutreachCampaignStatus.CONCLUIDA || campanha.status === OutreachCampaignStatus.CANCELADA) {
      throw new BadRequestException("Este disparo já foi encerrado. Crie um novo com a lista que falta.");
    }
    if (campanha.sourceType !== "XLSX" || !campanha.approvedAt || campanha.preparationRequestedAt) {
      throw new BadRequestException("Importe a planilha e aprove a campanha, as mensagens e as autorizações antes de iniciar.");
    }
    const impedidos = await this.db().platformOutreachTarget.count({ where: {
      campaignId: id, status: OutreachTargetStatus.PENDENTE,
      OR: [
        { consentStatus: { not: "CONFIRMADO" } }, { generationStatus: { not: "PRONTO" } },
        { approvalStatus: { not: "APROVADO" } }, { messageText: null },
      ],
    } });
    if (impedidos) throw new BadRequestException(`${impedidos} lead(s) ainda não estão autorizados, validados e aprovados.`);
    const canal = await this.whatsapp?.outreachChannelStatus();
    if (!canal?.connected) throw new BadRequestException("Conecte o WhatsApp institucional pelo Gupshup antes de iniciar.");
    if (!canal.template.approved) {
      throw new BadRequestException("O modelo de prospecção ainda não foi aprovado pela Meta. Confira a situação dele no topo da Central.");
    }
    const teto = await this.tetoDeGastoAlcancado(campanha);
    if (teto) throw new BadRequestException(`${mensagemDoTeto(teto)} Aumente o teto para retomar.`);
    const state = await this.db().platformOutreachSenderState.findUnique({ where: { channelId: campanha.channelId } });
    if (state?.inFlightTargetId) throw new BadRequestException("Existe uma tentativa de envio sem conclusão. Faça a conciliação antes de retomar.");
    const atualizada = await this.db().platformOutreachCampaign.update({
      where: { id },
      data: {
        status: OutreachCampaignStatus.ENVIANDO,
        pausedReason: null,
        startedAt: campanha.startedAt ?? new Date(),
        // Começa liberado: o primeiro envio sai no próximo giro do worker.
        nextSendAt: new Date(),
      },
    });
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(atualizada);
  }

  async pausar(id: string, motivo = "pausado pela equipe") {
    await this.buscarCampanha(id);
    const campanha = await this.db().platformOutreachCampaign.update({
      where: { id },
      data: { status: OutreachCampaignStatus.PAUSADA, pausedReason: motivo, nextSendAt: null },
    });
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(campanha);
  }

  async cancelar(id: string) {
    await this.buscarCampanha(id);
    const campanha = await this.db().$transaction(async (tx: any) => {
      // O que ainda não saiu não sai mais, mas fica registrado como descartado
      // em vez de desaparecer do relatório.
      await tx.platformOutreachTarget.updateMany({
        where: { campaignId: id, status: OutreachTargetStatus.PENDENTE },
        data: { status: OutreachTargetStatus.DESCARTADO, discardReason: "disparo cancelado" },
      });
      return tx.platformOutreachCampaign.update({
        where: { id },
        data: {
          status: OutreachCampaignStatus.CANCELADA,
          nextSendAt: null,
          completedAt: new Date(),
        },
      });
    });
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(campanha);
  }

  /**
   * Tira o disparo da tela sem apagar o histórico.
   *
   * Apagar de verdade levaria em cascata leads e tentativas: quem já recebeu
   * poderia ser abordado de novo numa próxima planilha, e o teto de 24h do
   * número deixaria de contar esses envios.
   */
  async excluir(id: string) {
    const campanha = await this.buscarCampanha(id);
    if (campanha.status === OutreachCampaignStatus.ENVIANDO) {
      throw new BadRequestException("Pause ou cancele o disparo antes de apagar.");
    }
    const state = await this.db().platformOutreachSenderState.findUnique({ where: { channelId: campanha.channelId } });
    if (state?.inFlightTargetId) {
      const alvo = await this.db().platformOutreachTarget.findUnique({ where: { id: state.inFlightTargetId } });
      if (alvo?.campaignId === id) {
        throw new BadRequestException("Este disparo tem uma tentativa sem conclusão. Faça a conciliação antes de apagar.");
      }
    }
    await this.db().$transaction(async (tx: any) => {
      await tx.platformOutreachTarget.updateMany({
        where: { campaignId: id, status: OutreachTargetStatus.PENDENTE },
        data: { status: OutreachTargetStatus.DESCARTADO, discardReason: "disparo apagado" },
      });
      await tx.platformOutreachCampaign.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          // Encerrado impede retomar e para a geração de mensagens pela IA.
          status: campanha.status === OutreachCampaignStatus.CONCLUIDA
            ? OutreachCampaignStatus.CONCLUIDA : OutreachCampaignStatus.CANCELADA,
          nextSendAt: null,
          preparationRequestedAt: null,
          completedAt: campanha.completedAt ?? new Date(),
        },
      });
    });
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return { id, deleted: true };
  }

  private async buscarCampanha(id: string) {
    const campanha = await this.db().platformOutreachCampaign.findUnique({ where: { id } });
    if (!campanha || campanha.deletedAt) throw new NotFoundException("Disparo não encontrado.");
    return campanha;
  }

  async senderStatus() {
    const canal = await this.whatsapp?.outreachChannelStatus();
    const channelId = canal?.channelId ?? "__none__";
    const [state, queued, sent, failed, activeCampaign] = await Promise.all([
      this.db().platformOutreachSenderState.findUnique({ where: { channelId } }),
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId, status: OutreachCampaignStatus.ENVIANDO }, status: OutreachTargetStatus.PENDENTE } }),
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId }, status: { in: [OutreachTargetStatus.ENVIADO, OutreachTargetStatus.RESPONDEU] } } }),
      this.db().platformOutreachTarget.count({ where: { campaign: { channelId }, status: OutreachTargetStatus.FALHOU } }),
      this.db().platformOutreachCampaign.findFirst({ where: { channelId, status: OutreachCampaignStatus.ENVIANDO }, select: { id: true, name: true } }),
    ]);
    return {
      configured: Boolean(canal?.connected && canal.template.approved),
      connected: Boolean(canal?.connected), phone: canal?.phone ?? null, template: canal?.template ?? null,
      queued, sent, failed, activeCampaign,
      nextAllowedAt: state?.nextAllowedAt ?? null,
      inFlightTargetId: state?.inFlightTargetId ?? null, inFlightAt: state?.inFlightAt ?? null,
    };
  }

  /** Nunca reenvia uma tentativa ambígua; só libera os próximos leads após reconhecimento humano. */
  async reconcileSender(targetId: string, userId: string) {
    if (!targetId) throw new BadRequestException("Informe a tentativa a conciliar.");
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { key: PLATFORM_CHANNEL_KEY } });
    if (!channel) throw new NotFoundException("Remetente não encontrado.");
    return this.db().$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT channelId FROM PlatformOutreachSenderState WHERE channelId = ${channel.id} FOR UPDATE`;
      const state = await tx.platformOutreachSenderState.findUnique({ where: { channelId: channel.id } });
      if (state?.inFlightTargetId !== targetId) throw new BadRequestException("Esta não é a tentativa pendente do remetente.");
      const target = await tx.platformOutreachTarget.findUnique({ where: { id: targetId } });
      if (!target) throw new NotFoundException("Lead da tentativa não encontrado.");
      if (target.status === OutreachTargetStatus.RESERVADO) {
        await tx.platformOutreachTarget.update({ where: { id: targetId }, data: {
          status: OutreachTargetStatus.FALHOU, errorMessage: "Resultado incerto; conciliação manual necessária no provedor.",
        } });
        await tx.platformOutreachCampaign.update({ where: { id: target.campaignId }, data: {
          status: OutreachCampaignStatus.PAUSADA, nextSendAt: null,
          failedCount: { increment: 1 }, pausedReason: "Tentativa incerta conciliada; não reenviar este lead.",
        } });
      }
      await tx.platformOutreachAttempt.updateMany({ where: { targetId, status: "INICIADA" }, data: {
        status: "INCERTA", errorMessage: `Liberada manualmente por ${userId}; não reenviar.`, finishedAt: new Date(),
      } });
      await tx.platformOutreachSenderState.update({ where: { channelId: channel.id }, data: {
        inFlightTargetId: null, inFlightAt: null,
      } });
      return { reconciled: true, targetId, resendAllowed: false };
    });
  }

  // ---------------------------------------------------------------------------
  // Lista de não contatar
  // ---------------------------------------------------------------------------

  async listarBloqueios() {
    const bloqueios = await this.db().platformOutreachBlock.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return bloqueios.map((bloqueio: any) => ({
      ...bloqueio,
      phoneFormatted: formatarTelefoneParaExibicao(bloqueio.phone),
    }));
  }

  async bloquear(dto: BlockOutreachPhoneDto, userId?: string | null) {
    const phone = normalizarTelefoneBrasileiro(dto.phone);
    if (!phone) throw new BadRequestException("Número inválido. Use DDD e número.");
    // Quem bloqueou fica registrado: um número que alguém tirou da lista à mão
    // costuma voltar como pergunta ("por que este não recebeu?").
    const autor = userId
      ? await this.db().user.findUnique({ where: { id: userId }, select: { name: true } })
      : null;
    const bloqueio = await this.db().platformOutreachBlock.upsert({
      where: { phone },
      create: { phone, reason: dto.reason?.trim() || "adicionado à mão", blockedByName: autor?.name ?? null },
      update: { reason: dto.reason?.trim() || undefined },
    });
    await this.db().platformOutreachTarget.updateMany({
      where: { phone, status: OutreachTargetStatus.PENDENTE },
      data: { status: OutreachTargetStatus.DESCARTADO, discardReason: "está na lista de não contatar" },
    });
    return { ...bloqueio, phoneFormatted: formatarTelefoneParaExibicao(bloqueio.phone) };
  }

  async desbloquear(id: string) {
    const bloqueio = await this.db().platformOutreachBlock.findUnique({ where: { id } });
    if (!bloqueio) throw new NotFoundException("Bloqueio não encontrado.");
    await this.db().platformOutreachBlock.delete({ where: { id } });
    return { id };
  }

  // ---------------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------------

  /**
   * Um envio por giro, por campanha.
   *
   * O ritmo fica no registro da campanha e do remetente, então reiniciar o
   * processo não atropela a fila nem reenvia o que já saiu.
   */
  async processarDisparos(agora = new Date()) {
    if (this.processando) return;
    this.processando = true;
    try {
      await this.girar(agora);
    } catch (error) {
      // Quem chama é o `setInterval`, sem ninguém para esperar a promessa: uma
      // exceção aqui viraria rejeição não tratada e derrubaria o processo por
      // causa de uma indisponibilidade momentânea do banco.
      this.logger.error(
        `Falha no giro da prospecção: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.processando = false;
    }
  }

  private async girar(agora: Date) {
    // Sem conexão, a fila permanece íntegra e retoma quando o QR for autenticado.
    // Sem número conectado ou modelo aprovado, a fila espera intacta.
    const canal = await this.whatsapp?.outreachChannelStatus();
    if (!canal?.connected || !canal.template.approved) return;
    const campanhas = await this.db().platformOutreachCampaign.findMany({
      where: { status: OutreachCampaignStatus.ENVIANDO, channel: { key: PLATFORM_CHANNEL_KEY } },
      orderBy: { nextSendAt: "asc" },
      include: { channel: true },
    });
    if (!campanhas.length) return;

    const enviadosNoNumero = await this.db().platformOutreachTarget.count({
      where: { campaign: { channel: { key: PLATFORM_CHANNEL_KEY } }, sentAt: { gte: inicioDaJanelaRolante(agora) } },
    });
    if (enviadosNoNumero >= tetoDiarioDoNumero()) {
      // Reagenda em vez de girar a cada 10 segundos consultando o banco.
      await this.db().platformOutreachCampaign.updateMany({
        where: { status: OutreachCampaignStatus.ENVIANDO, channel: { key: PLATFORM_CHANNEL_KEY } },
        data: { nextSendAt: new Date(agora.getTime() + ESPERA_APOS_TETO_MS) },
      });
      this.logger.warn(`Teto operacional de ${tetoDiarioDoNumero()} tentativas em 24h alcançado no remetente de prospecção. Campanhas reagendadas.`);
      return;
    }

    for (const campanha of campanhas) {
      try {
        // Um envio por giro no total: o mesmo número atende todas as campanhas.
        if (await this.avancarCampanha(campanha, agora)) break;
      } catch (error) {
        // Uma campanha com problema não pode parar as outras.
        this.logger.error(
          `Falha ao avançar o disparo ${campanha.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Devolve true quando um envio saiu, para o giro parar aí. */
  private async avancarCampanha(campanha: any, agora: Date): Promise<boolean> {
    if (campanha.sourceType !== "XLSX" || !campanha.approvedAt) {
      await this.pausar(campanha.id, "Campanha sem aprovação comprovada; envio bloqueado.");
      return false;
    }
    if (campanha.nextSendAt && new Date(campanha.nextSendAt).getTime() > agora.getTime()) return false;

    // Conferido antes de cada envio: o gasto passa do teto no máximo pelo custo
    // de uma mensagem, a última que saiu antes de alcançá-lo.
    const teto = await this.tetoDeGastoAlcancado(campanha);
    if (teto) {
      await this.pausar(campanha.id, `${mensagemDoTeto(teto)} Aumente o teto para retomar.`);
      return false;
    }

    // Janela rolante de 24h, e não "hoje": evita a
    // virada de dia do fuso do servidor liberar o dobro de envios de uma vez.
    const enviadosNaJanela = await this.db().platformOutreachTarget.count({
      where: { campaignId: campanha.id, sentAt: { gte: inicioDaJanelaRolante(agora) } },
    });
    if (enviadosNaJanela >= campanha.dailyLimit) {
      // Reagenda: sem isso o worker giraria a cada 10 segundos batendo no limite
      // e consultando o banco à toa.
      await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: { nextSendAt: new Date(agora.getTime() + ESPERA_APOS_TETO_MS) },
      });
      return false;
    }

    const alvo = await this.db().platformOutreachTarget.findFirst({
      where: { campaignId: campanha.id, status: OutreachTargetStatus.PENDENTE },
      orderBy: { createdAt: "asc" },
    });
    if (!alvo) {
      await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: {
          status: OutreachCampaignStatus.CONCLUIDA,
          nextSendAt: null,
          completedAt: new Date(),
        },
      });
      this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
      this.logger.log(`Disparo "${campanha.name}" concluído.`);
      return false;
    }

    const attemptId = await this.reservarEnvio(campanha, alvo);
    if (!attemptId) return false;
    await this.enviarParaAlvo(campanha, alvo, attemptId);
    this.realtime?.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
    return true;
  }

  /** Trava transacional persistente do número: vale entre campanhas e réplicas. */
  private async reservarEnvio(campanha: any, alvo: any): Promise<string | null> {
    return this.db().$transaction(async (tx: any) => {
      await tx.platformOutreachSenderState.upsert({
        where: { channelId: campanha.channelId },
        create: { channelId: campanha.channelId }, update: {},
      });
      await tx.$queryRaw`SELECT channelId FROM PlatformOutreachSenderState WHERE channelId = ${campanha.channelId} FOR UPDATE`;
      const state = await tx.platformOutreachSenderState.findUnique({ where: { channelId: campanha.channelId } });
      const startedAt = new Date();
      if (state.inFlightTargetId || (state.nextAllowedAt && new Date(state.nextAllowedAt) > startedAt)) return null;
      const currentCampaign = await tx.platformOutreachCampaign.findUnique({ where: { id: campanha.id } });
      const currentTarget = await tx.platformOutreachTarget.findUnique({ where: { id: alvo.id } });
      if (currentCampaign?.status !== OutreachCampaignStatus.ENVIANDO || !currentCampaign.approvedAt
        || currentTarget?.status !== OutreachTargetStatus.PENDENTE || currentTarget.attempts > 0
        || currentTarget.consentStatus !== "CONFIRMADO" || currentTarget.approvalStatus !== "APROVADO"
        || currentTarget.generationStatus !== "PRONTO" || !currentTarget.proposal || !currentTarget.messageText) return null;
      const [blocked, previousAttempt] = await Promise.all([
        tx.platformOutreachBlock.findUnique({ where: { phone: alvo.phone } }),
        tx.platformOutreachTarget.findFirst({ where: { phone: alvo.phone, id: { not: alvo.id }, attempts: { gt: 0 } }, select: { id: true } }),
      ]);
      if (blocked || previousAttempt) {
        await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
          status: OutreachTargetStatus.DESCARTADO,
          discardReason: blocked ? "pediu para não receber" : "já houve tentativa para este número",
        } });
        return null;
      }
      const attemptId = randomUUID();
      await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
        status: OutreachTargetStatus.RESERVADO, attempts: { increment: 1 },
      } });
      await tx.platformOutreachAttempt.create({ data: {
        id: attemptId, targetId: alvo.id, campaignId: campanha.id, channelId: campanha.channelId, startedAt,
      } });
      const nextAllowedAt = new Date(startedAt.getTime() + OUTREACH_MIN_INTERVAL_MS);
      await tx.platformOutreachSenderState.update({ where: { channelId: campanha.channelId }, data: {
        inFlightTargetId: alvo.id, inFlightAt: startedAt, nextAllowedAt,
      } });
      await tx.platformOutreachCampaign.update({ where: { id: campanha.id }, data: { nextSendAt: nextAllowedAt } });
      return attemptId;
    }, { timeout: 10_000 });
  }

  private async enviarParaAlvo(campanha: any, alvo: any, attemptId: string) {
    try {
      const latest = await this.db().platformOutreachTarget.findUnique({ where: { id: alvo.id } });
      const currentCampaign = await this.db().platformOutreachCampaign.findUnique({ where: { id: campanha.id } });
      const blocked = await this.db().platformOutreachBlock.findUnique({ where: { phone: alvo.phone } });
      const variables = Array.isArray(latest?.templateVariables) ? latest.templateVariables.map(String) : [];
      if (blocked || currentCampaign?.status !== OutreachCampaignStatus.ENVIANDO
        || latest?.consentStatus !== "CONFIRMADO" || latest?.status !== OutreachTargetStatus.RESERVADO
        || variables.length !== 3 || variables.some((value: string) => !value.trim())
        || latest.approvalStatus !== "APROVADO") {
        // Nada foi entregue ao provedor; registrar como não enviado (não INCERTO)
        // e liberar a trava. Não ressuscitar alvo cancelado ou sem consentimento.
        await this.db().$transaction(async (tx: any) => {
          await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
            status: OutreachTargetStatus.DESCARTADO,
            discardReason: "Envio abortado antes do WhatsApp: campanha pausada/cancelada, autorização ou variáveis inválidas.",
          } });
          await tx.platformOutreachAttempt.update({ where: { id: attemptId }, data: {
            status: "NAO_ENVIADA", finishedAt: new Date(), errorMessage: "Abordagem abortada antes da chamada ao WhatsApp.",
          } });
          await tx.platformOutreachSenderState.updateMany({ where: { channelId: campanha.channelId, inFlightTargetId: alvo.id },
            data: { inFlightTargetId: null, inFlightAt: null } });
        });
        return;
      }
      // Mesmo caminho da conversa avulsa: modelo aprovado pelo Gupshup, conversa
      // e mensagem no painel do atendimento, custo de marketing registrado. A
      // conversa abre com a IA, que responde na hora quando o lead tocar num botão.
      const { conversation, message } = await this.whatsapp!.openConversationWith({
        phone: latest.phone, name: latest.name, company: latest.company, city: latest.city,
        text: null, variables, mode: WhatsAppConversationMode.VIRTUAL,
      });
      const custo = await this.custoDoEnvio(message?.providerMessageId ?? null);
      await this.db().$transaction(async (tx: any) => {
        await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
          status: OutreachTargetStatus.ENVIADO, conversationId: conversation.id, sentAt: new Date(), errorMessage: null,
        } });
        await tx.platformOutreachAttempt.update({ where: { id: attemptId }, data: {
          status: "ENVIADA", providerMessageId: message?.providerMessageId ?? null, finishedAt: new Date(),
        } });
        await tx.platformOutreachCampaign.update({ where: { id: campanha.id }, data: {
          sentCount: { increment: 1 }, spentAmount: { increment: custo },
        } });
        await tx.platformOutreachSenderState.updateMany({ where: {
          channelId: campanha.channelId, inFlightTargetId: alvo.id,
        }, data: { inFlightTargetId: null, inFlightAt: null } });
      });
    } catch (error) {
      // O lead vira FALHOU e nunca é reenviado, então a trava pode ser liberada
      // sem risco de duplicar. A campanha pausa porque erro do provedor quase
      // sempre é geral (modelo, saldo, credencial) e repetiria em todo lead.
      const mensagem = error instanceof Error ? error.message : String(error);
      await this.db().$transaction(async (tx: any) => {
        await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
          status: OutreachTargetStatus.FALHOU, errorMessage: mensagem.slice(0, 500),
        } });
        await tx.platformOutreachAttempt.update({ where: { id: attemptId }, data: {
          status: "INCERTA", errorMessage: mensagem.slice(0, 500), finishedAt: new Date(),
        } });
        await tx.platformOutreachCampaign.update({ where: { id: campanha.id }, data: {
          failedCount: { increment: 1 }, status: OutreachCampaignStatus.PAUSADA, nextSendAt: null,
          pausedReason: `O Gupshup recusou o envio: ${mensagem.slice(0, 300)}. Corrija e retome; este lead não será reenviado.`,
        } });
        await tx.platformOutreachSenderState.updateMany({ where: {
          channelId: campanha.channelId, inFlightTargetId: alvo.id,
        }, data: { inFlightTargetId: null, inFlightAt: null } });
      });
      this.logger.warn(`Tentativa ${attemptId} da campanha ${campanha.id} falhou: ${mensagem}`);
    }
  }

  /**
   * Custo de uma abertura: o mesmo valor que o envio registrou no consumo da
   * plataforma (tarifa da Meta + taxa do Gupshup). Sem registro, usa a tarifa
   * de marketing, para o teto nunca deixar de contar uma mensagem que saiu.
   */
  private async custoDoEnvio(providerMessageId: string | null) {
    if (providerMessageId) {
      const registro = await this.db().platformUsageLedger.findUnique({
        where: { externalReference: `platform-whatsapp:${providerMessageId}` },
      });
      if (registro) return Number(registro.providerAmount);
    }
    const tarifa = await this.db().usageRate.findUnique({ where: { metric: UsageMetric.WHATSAPP_TEMPLATE_MARKETING } });
    return tarifa ? Number(tarifa.providerUnitCost) : 0;
  }

}
/**
 * Início da janela de 24h que conta para os limites.
 *
 * Rolante, e não "desde a meia-noite": a meia-noite do
 * fuso do servidor liberaria o limite inteiro de uma vez no meio da tarde
 * brasileira.
 */
function inicioDaJanelaRolante(momento: Date) {
  return new Date(momento.getTime() - 24 * 60 * 60 * 1000);
}

function arredondarCentavos(valor: number) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function reais(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mensagemDoTeto(teto: { limite: number; gasto: number }) {
  return `Teto de gasto de ${reais(teto.limite)} alcançado (gasto: ${reais(teto.gasto)}).`;
}
