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
  WhatsAppConversationMode,
} from "@prisma/client";
import { runsOutreachJobs } from "../common/config/app-role";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { OutreachIntelligenceService } from "./outreach-intelligence.service";
import { BaileysOutreachSenderService } from "./baileys-outreach-sender.service";
import { OUTREACH_CHANNEL_KEY, OUTREACH_MIN_INTERVAL_MS } from "./outreach-intelligence";
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
 * Janela em que uma abordagem comercial autorizada é aceitável.
 * Domingo fica de fora para evitar contato fora do expediente.
 */
const HORA_INICIAL_PADRAO = 9;
const HORA_FINAL_PADRAO = 20;

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
    private readonly realtime: RealtimeGateway,
    @Optional() private readonly intelligence?: OutreachIntelligenceService,
    @Optional() private readonly sender?: BaileysOutreachSenderService,
  ) {}

  onModuleInit() {
    // A fila só roda no serviço privado outreach-worker. A trava persistente
    // ainda protege contra instâncias acidentalmente duplicadas.
    if (!runsOutreachJobs()) {
      this.logger.log("Prospecção desativada neste processo; exige APP_ROLE=outreach-worker.");
      return;
    }
    this.timer = setInterval(() => void this.processarDisparos(), INTERVALO_DO_WORKER_MS);
    this.timer.unref();
    this.intelligenceTimer = setInterval(() => void this.processarInteligencia(), INTERVALO_DO_WORKER_MS);
    this.intelligenceTimer.unref();
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
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const pendentes = await this.pendentesPorCampanha(campanhas.map((campanha: any) => campanha.id));
    return campanhas.map((campanha: any) => this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0));
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
    const pendentes = await this.pendentesPorCampanha([campanha.id]);
    return this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0);
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
    const pendentes = await this.pendentesPorCampanha([campanha.id]);
    // O total dos contatos carregados sai junto: uma lista de 2 mil aparecia
    // cortada em 500 sem nada dizendo que havia mais.
    const alvosNoTotal = await this.db().platformOutreachTarget.count({
      where: { campaignId: campanha.id },
    });
    return {
      ...this.resumoDaCampanha(campanha, pendentes.get(campanha.id) ?? 0),
      targetsTotal: alvosNoTotal,
      targets: campanha.targets.map((alvo: any) => ({
        ...alvo,
        phoneFormatted: formatarTelefoneParaExibicao(alvo.phone),
      })),
    };
  }

  private resumoDaCampanha(campanha: any, pendentes?: number) {
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
    if (!(await this.sender?.status())?.configured)
      throw new BadRequestException("Conecte o WhatsApp de Prospecção pelo QR Code antes de iniciar.");
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
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(atualizada);
  }

  async pausar(id: string, motivo = "pausado pela equipe") {
    await this.buscarCampanha(id);
    const campanha = await this.db().platformOutreachCampaign.update({
      where: { id },
      data: { status: OutreachCampaignStatus.PAUSADA, pausedReason: motivo, nextSendAt: null },
    });
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
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
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoComFila(campanha);
  }

  private async buscarCampanha(id: string) {
    const campanha = await this.db().platformOutreachCampaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundException("Disparo não encontrado.");
    return campanha;
  }

  async senderStatus() {
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { key: OUTREACH_CHANNEL_KEY } });
    const state = channel ? await this.db().platformOutreachSenderState.findUnique({ where: { channelId: channel.id } }) : null;
    return { ...(await this.sender?.status()), nextAllowedAt: state?.nextAllowedAt ?? null,
      inFlightTargetId: state?.inFlightTargetId ?? null, inFlightAt: state?.inFlightAt ?? null };
  }

  /** Nunca reenvia uma tentativa ambígua; só libera os próximos leads após reconhecimento humano. */
  async reconcileSender(targetId: string, userId: string) {
    if (!targetId) throw new BadRequestException("Informe a tentativa a conciliar.");
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { key: OUTREACH_CHANNEL_KEY } });
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
    if (!(await this.sender?.status())?.configured) return;
    const campanhas = await this.db().platformOutreachCampaign.findMany({
      where: { status: OutreachCampaignStatus.ENVIANDO, channel: { key: OUTREACH_CHANNEL_KEY } },
      orderBy: { nextSendAt: "asc" },
      include: { channel: true },
    });
    if (!campanhas.length) return;

    const enviadosNoNumero = await this.db().platformOutreachTarget.count({
      where: { campaign: { channel: { key: OUTREACH_CHANNEL_KEY } }, sentAt: { gte: inicioDaJanelaRolante(agora) } },
    });
    if (enviadosNoNumero >= tetoDiarioDoNumero()) {
      // Reagenda em vez de girar a cada 10 segundos consultando o banco.
      await this.db().platformOutreachCampaign.updateMany({
        where: { status: OutreachCampaignStatus.ENVIANDO, channel: { key: OUTREACH_CHANNEL_KEY } },
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
    if (campanha.respectBusinessHours && !dentroDoHorarioComercial(agora)) return false;

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
      this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
      this.logger.log(`Disparo "${campanha.name}" concluído.`);
      return false;
    }

    const attemptId = await this.reservarEnvio(campanha, alvo);
    if (!attemptId) return false;
    await this.enviarParaAlvo(campanha, alvo, attemptId);
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
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
      const messageText = String(latest?.messageText ?? "").trim();
      if (blocked || currentCampaign?.status !== OutreachCampaignStatus.ENVIANDO
        || latest?.consentStatus !== "CONFIRMADO" || latest?.status !== OutreachTargetStatus.RESERVADO
        || !messageText || messageText.length > 500 || latest.approvalStatus !== "APROVADO") {
        // Nada foi entregue ao socket; registrar como não enviado (não INCERTO)
        // e liberar a trava. Não ressuscitar alvo cancelado ou sem consentimento.
        await this.db().$transaction(async (tx: any) => {
          await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
            status: OutreachTargetStatus.DESCARTADO,
            discardReason: "Envio abortado antes do socket: campanha pausada/cancelada, autorização ou copy inválida.",
          } });
          await tx.platformOutreachAttempt.update({ where: { id: attemptId }, data: {
            status: "NAO_ENVIADA", finishedAt: new Date(), errorMessage: "Abordagem abortada antes da chamada ao WhatsApp.",
          } });
          await tx.platformOutreachSenderState.updateMany({ where: { channelId: campanha.channelId, inFlightTargetId: alvo.id },
            data: { inFlightTargetId: null, inFlightAt: null } });
        });
        return;
      }
      const sent = await this.sender!.sendText({ to: latest.phone, text: messageText, attemptId });
      await this.db().$transaction(async (tx: any) => {
        const conversation = await tx.platformWhatsAppConversation.upsert({
          where: { channelId_customerPhone: { channelId: campanha.channelId, customerPhone: latest.phone } },
          create: { channelId: campanha.channelId, customerPhone: latest.phone,
            customerName: latest.name, mode: WhatsAppConversationMode.HUMANO,
            lastMessageText: messageText, lastMessageAt: new Date() },
          update: { mode: WhatsAppConversationMode.HUMANO, lastMessageText: messageText, lastMessageAt: new Date() },
        });
        await tx.platformWhatsAppMessage.create({ data: {
          channelId: campanha.channelId, conversationId: conversation.id,
          providerMessageId: sent.messageId, direction: "ENVIADA", status: "ENVIADA",
          type: "text", body: messageText,
        } });
        await tx.platformOutreachTarget.update({ where: { id: alvo.id }, data: {
          status: OutreachTargetStatus.ENVIADO, conversationId: conversation.id, sentAt: new Date(), errorMessage: null,
        } });
        await tx.platformOutreachAttempt.update({ where: { id: attemptId }, data: {
          status: "ENVIADA", providerMessageId: sent.messageId, finishedAt: new Date(),
        } });
        await tx.platformOutreachCampaign.update({ where: { id: campanha.id }, data: { sentCount: { increment: 1 } } });
        await tx.platformOutreachSenderState.updateMany({ where: {
          channelId: campanha.channelId, inFlightTargetId: alvo.id,
        }, data: { inFlightTargetId: null, inFlightAt: null } });
      });
    } catch (error) {
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
          pausedReason: "Envio incerto ou recusado. Conferir o provedor e conciliar a tentativa antes de continuar.",
        } });
        // A trava fica ocupada intencionalmente: timeout pode ter enviado.
      });
      this.logger.warn(`Tentativa ${attemptId} da campanha ${campanha.id} precisa de conciliação: ${mensagem}`);
    }
  }

}
function partesNoFusoComercial(momento: Date) {
  const timeZone = process.env.BUSINESS_TIMEZONE ?? "America/Sao_Paulo";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(momento);
  return {
    hora: Number(partes.find((parte) => parte.type === "hour")?.value ?? 0),
    diaDaSemana: (partes.find((parte) => parte.type === "weekday")?.value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  };
}

export function dentroDoHorarioComercial(momento = new Date()) {
  const { hora, diaDaSemana } = partesNoFusoComercial(momento);
  if (diaDaSemana.startsWith("dom")) return false;
  return hora >= HORA_INICIAL_PADRAO && hora < HORA_FINAL_PADRAO;
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
