import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  OutreachCampaignStatus,
  OutreachTargetStatus,
  WhatsAppConversationMode,
} from "@prisma/client";
import { runsBackgroundJobs } from "../common/config/app-role";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { PlatformWhatsAppService } from "./platform-whatsapp.service";
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
 * Janela em que uma abordagem comercial é aceitável.
 *
 * Mensagem de venda às 3h da manhã é o caminho mais curto para ser denunciado, e
 * denúncia derruba a qualidade do número institucional — que é o mesmo do
 * suporte. Domingo fica de fora pelo mesmo motivo.
 */
const HORA_INICIAL_PADRAO = 9;
const HORA_FINAL_PADRAO = 20;

/**
 * Teto de conversas iniciadas por nós em 24h, somando todos os disparos.
 *
 * A Meta limita conversa iniciada pela empresa por faixas — um número novo
 * começa em 250 por 24h e sobe conforme a qualidade. Passar do teto faz o
 * provedor recusar, e recusa em série derruba a reputação. O limite por disparo
 * não protege disso: três disparos de 200 somam 600 no mesmo número.
 */
function tetoDiarioDoNumero() {
  const configurado = Number(process.env.WHATSAPP_OUTREACH_DAILY_CAP ?? "");
  return Number.isFinite(configurado) && configurado > 0 ? Math.floor(configurado) : 250;
}

/** Acima disso o disparo para sozinho: erro em série é configuração errada. */
const FALHAS_SEGUIDAS_PARA_PAUSAR = 5;
const PROPORCAO_DE_FALHA_PARA_PAUSAR = 0.3;
const TENTATIVAS_MINIMAS_PARA_AVALIAR = 10;

type Contato = { phone: string; name: string | null; city: string | null };

/**
 * Prospecção ativa pelo número institucional.
 *
 * O disparo é deliberadamente lento. O que se protege aqui não é a mensagem, é o
 * número: se ele for restringido pela Meta por denúncia de spam, cai junto o
 * atendimento de quem já é cliente, porque é o mesmo número. Por isso o envio sai
 * um por vez, com intervalo, dentro do horário comercial, e para sozinho quando
 * começa a falhar.
 */
@Injectable()
export class PlatformOutreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformOutreachService.name);
  private timer?: NodeJS.Timeout;
  private processando = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly platform: PlatformWhatsAppService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit() {
    // Réplica de HTTP puro não dispara. Sem isto, cada réplica de API rodaria o
    // mesmo worker: o intervalo entre mensagens ficaria dividido pelo número de
    // réplicas e a mesma pessoa poderia receber duas abordagens. Ver
    // common/config/app-role.ts.
    if (!runsBackgroundJobs()) {
      this.logger.log("Processo em papel de API: prospecção não dispara aqui.");
      return;
    }
    this.timer = setInterval(() => void this.processarDisparos(), INTERVALO_DO_WORKER_MS);
    this.timer.unref();
    void this.processarDisparos();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
       * deixa a frase no lugar do nome, e essa frase entraria no {{1}} do modelo
       * aprovado. Mostrar a leitura antes do disparo resolve o que adivinhar não
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

  async criarCampanha(userId: string, dto: CreateOutreachCampaignDto) {
    const channel = await this.db().platformWhatsAppChannel.findFirst();
    if (!channel) throw new BadRequestException("Configure o WhatsApp institucional antes de prospectar.");

    const leitura = lerListaDeContatos(dto.contacts);
    if (!leitura.contatos.length) {
      throw new BadRequestException(
        "Nenhum telefone válido na lista. Cada linha precisa de DDD e número, como (62) 99999-8888.",
      );
    }
    const descartes = await this.classificarDescartes(leitura.contatos);
    const aptos = leitura.contatos.filter((contato) => !descartes.has(contato.phone));
    if (!aptos.length) {
      throw new BadRequestException(
        "Todos os números da lista já foram abordados, já são clientes ou pediram para não receber.",
      );
    }

    const user = await this.db().user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    // O piso é o giro do worker: pedir 5 segundos não faria a mensagem sair em
    // 5, e um intervalo que a configuração aceita mas o sistema não cumpre é
    // pior do que um limite declarado.
    const minimo = Math.max(dto.minIntervalSeconds ?? 15, INTERVALO_DO_WORKER_MS / 1000);
    const campanha = await this.db().platformOutreachCampaign.create({
      data: {
        channelId: channel.id,
        name: dto.name.trim(),
        fallbackName: dto.fallbackName?.trim() || "tudo bem",
        dailyLimit: Math.min(Math.max(dto.dailyLimit ?? 200, 1), 1000),
        minIntervalSeconds: minimo,
        // Intervalo máximo menor que o mínimo faria o sorteio devolver NaN e o
        // disparo parar sem explicação.
        maxIntervalSeconds: Math.max(dto.maxIntervalSeconds ?? 30, minimo),
        respectBusinessHours: dto.respectBusinessHours ?? true,
        createdByUserId: user?.id ?? null,
        createdByName: user?.name ?? null,
        totalTargets: aptos.length,
        targets: {
          create: [
            ...aptos.map((contato) => ({
              phone: contato.phone,
              name: contato.name,
              city: contato.city,
            })),
            // Os descartados ficam registrados para o relatório do disparo
            // fechar com o que foi colado. Apagados, ninguém entenderia por que
            // 400 números viraram 120 envios.
            ...[...descartes.entries()].map(([phone, motivo]) => ({
              phone,
              status: OutreachTargetStatus.DESCARTADO,
              discardReason: motivo,
            })),
          ],
        },
      },
      include: { _count: { select: { targets: true } } },
    });

    this.logger.log(
      `Disparo "${campanha.name}" criado com ${aptos.length} contato(s) aptos e ${descartes.size} descartado(s).`,
    );
    return this.detalharCampanha(campanha.id);
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
    const channel = await this.db().platformWhatsAppChannel.findUnique({ where: { id: campanha.channelId } });
    if (!channel?.outreachTemplateId && !channel?.outreachTemplateName) {
      throw new BadRequestException(
        "Cadastre o modelo aprovado na Meta antes de começar. Número que nunca escreveu só recebe modelo.",
      );
    }
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
   * Enviar em lote seria mais rápido e é exatamente o que faz a Meta tratar o
   * número como robô. O ritmo fica no registro da campanha, então reiniciar o
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
    const campanhas = await this.db().platformOutreachCampaign.findMany({
      where: { status: OutreachCampaignStatus.ENVIANDO },
      orderBy: { nextSendAt: "asc" },
      include: { channel: true },
    });
    if (!campanhas.length) return;

    const enviadosNoNumero = await this.db().platformOutreachTarget.count({
      where: { sentAt: { gte: inicioDaJanelaRolante(agora) } },
    });
    if (enviadosNoNumero >= tetoDiarioDoNumero()) {
      // Reagenda em vez de girar a cada 10 segundos consultando o banco.
      await this.db().platformOutreachCampaign.updateMany({
        where: { status: OutreachCampaignStatus.ENVIANDO },
        data: { nextSendAt: new Date(agora.getTime() + ESPERA_APOS_TETO_MS) },
      });
      this.logger.warn(
        `Teto de ${tetoDiarioDoNumero()} conversas iniciadas em 24h alcançado no número institucional. Disparos reagendados.`,
      );
      return;
    }

    for (const campanha of campanhas) {
      try {
        // Um envio por giro no total, não por campanha: o que a Meta observa é
        // o número, e ele é o mesmo para todos os disparos.
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
    if (campanha.nextSendAt && new Date(campanha.nextSendAt).getTime() > agora.getTime()) return false;
    if (campanha.respectBusinessHours && !dentroDoHorarioComercial(agora)) return false;

    // Janela rolante de 24h, e não "hoje": é assim que a Meta conta, e evita a
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

    /**
     * Reserva o contato antes de enviar.
     *
     * O incremento condicionado ao número de tentativas que acabamos de ler é
     * uma trava otimista: se outro processo tomou o mesmo contato entre a busca
     * e aqui, a contagem volta zero e este giro desiste em vez de mandar a
     * segunda mensagem para a mesma pessoa. Vale também para o giro que demora
     * mais que o intervalo do worker.
     */
    const tentativasAntes = alvo.attempts ?? 0;
    const tentativa = tentativasAntes + 1;
    const reserva = await this.db().platformOutreachTarget.updateMany({
      where: { id: alvo.id, status: OutreachTargetStatus.PENDENTE, attempts: tentativasAntes },
      data: { attempts: tentativa },
    });
    if (reserva.count !== 1) return false;

    await this.enviarParaAlvo(campanha, { ...alvo, attempts: tentativa });
    await this.db().platformOutreachCampaign.update({
      where: { id: campanha.id },
      data: { nextSendAt: new Date(agora.getTime() + sorteioDeIntervaloMs(campanha)) },
    });
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
    return true;
  }

  private async enviarParaAlvo(campanha: any, alvo: any) {
    try {
      const { conversation } = await this.platform.openConversationWith({
        phone: alvo.phone,
        name: alvo.name,
        city: alvo.city,
        fallbackName: campanha.fallbackName,
        // Conversa de prospecção nasce com o assistente: a resposta pode chegar
        // de madrugada, e deixar a pessoa sem resposta depois de ela responder a
        // uma abordagem nossa é pior do que não ter abordado.
        mode: WhatsAppConversationMode.VIRTUAL,
      });
      await this.db().platformOutreachTarget.update({
        where: { id: alvo.id },
        data: {
          status: OutreachTargetStatus.ENVIADO,
          conversationId: conversation.id,
          sentAt: new Date(),
          errorMessage: null,
        },
      });
      await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: { sentCount: { increment: 1 } },
      });
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      /**
       * Uma tentativa por contato, e o erro fica registrado.
       *
       * A retentativa automática parecia cuidado e era risco: quando a falha é
       * ambígua — tempo esgotado, resposta ilegível — o provedor pode ter
       * entregado a mensagem, e insistir manda a mesma abordagem duas vezes para
       * um desconhecido. Recolar o número numa lista nova continua funcionando, e
       * aí a decisão de repetir é de quem leu o erro.
       */
      await this.db().platformOutreachTarget.update({
        where: { id: alvo.id },
        data: { status: OutreachTargetStatus.FALHOU, errorMessage: mensagem.slice(0, 500) },
      });
      const atualizada = await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: { failedCount: { increment: 1 } },
      });
      await this.pausarSeEstiverFalhandoDemais(atualizada, mensagem);
      this.logger.warn(`Falha ao abordar ${alvo.phone} no disparo ${campanha.id}: ${mensagem}`);
    }
  }

  /**
   * Para o disparo quando o padrão é falha.
   *
   * O caso que isto pega é modelo recusado pela Meta: sem a pausa, uma lista de
   * 300 números viraria 300 tentativas idênticas, todas negadas, cada uma
   * registrada pelo provedor contra o número.
   */
  private async pausarSeEstiverFalhandoDemais(campanha: any, ultimoErro: string) {
    const tentativas = campanha.sentCount + campanha.failedCount;
    const nadaFuncionou = campanha.sentCount === 0 && campanha.failedCount >= FALHAS_SEGUIDAS_PARA_PAUSAR;
    const falhaDemais = tentativas >= TENTATIVAS_MINIMAS_PARA_AVALIAR
      && campanha.failedCount / tentativas > PROPORCAO_DE_FALHA_PARA_PAUSAR;
    if (!nadaFuncionou && !falhaDemais) return;
    await this.db().platformOutreachCampaign.update({
      where: { id: campanha.id },
      data: {
        status: OutreachCampaignStatus.PAUSADA,
        nextSendAt: null,
        pausedReason: `Pausado automaticamente: ${campanha.failedCount} de ${tentativas} envios falharam. Último erro: ${ultimoErro.slice(0, 200)}`,
      },
    });
    this.logger.error(`Disparo "${campanha.name}" pausado automaticamente por falhas em série.`);
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
  }
}

/** Intervalo sorteado entre dois envios, em milissegundos. */
function sorteioDeIntervaloMs(campanha: { minIntervalSeconds: number; maxIntervalSeconds: number }) {
  const minimo = Math.max(campanha.minIntervalSeconds, 1);
  const maximo = Math.max(campanha.maxIntervalSeconds, minimo);
  // Intervalo sorteado, e não fixo: cadência de metrônomo é o que denuncia
  // envio automático.
  return (minimo + Math.random() * (maximo - minimo)) * 1000;
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
 * Rolante, e não "desde a meia-noite": é como a Meta conta, e a meia-noite do
 * fuso do servidor liberaria o limite inteiro de uma vez no meio da tarde
 * brasileira.
 */
function inicioDaJanelaRolante(momento: Date) {
  return new Date(momento.getTime() - 24 * 60 * 60 * 1000);
}
