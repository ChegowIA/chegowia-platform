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

/** De quanto em quanto tempo o processo olha se há envio vencido. */
const INTERVALO_DO_WORKER_MS = 10_000;

/**
 * Janela em que uma abordagem comercial é aceitável.
 *
 * Mensagem de venda às 3h da manhã é o caminho mais curto para ser denunciado, e
 * denúncia derruba a qualidade do número institucional — que é o mesmo do
 * suporte. Domingo fica de fora pelo mesmo motivo.
 */
const HORA_INICIAL_PADRAO = 9;
const HORA_FINAL_PADRAO = 20;

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
    this.timer = setInterval(() => void this.processarDisparos(), INTERVALO_DO_WORKER_MS);
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
    return {
      total: leitura.contatos.length,
      aptos: leitura.contatos.filter((contato) => !descartes.has(contato.phone)).length,
      repetidosNaLista: leitura.repetidos,
      recusados: leitura.recusados,
      possiveisFixos: leitura.possiveisFixos.map(formatarTelefoneParaExibicao),
      descartados: [...descartes.entries()].map(([phone, motivo]) => ({
        phone: formatarTelefoneParaExibicao(phone),
        motivo,
      })),
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
        select: { customerPhone: true },
      }),
      this.db().platformOutreachTarget.findMany({
        where: { phone: { in: numeros } },
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
    for (const { customerPhone } of conversas) {
      if (!motivos.has(customerPhone)) motivos.set(customerPhone, "já existe conversa com este número");
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
    const minimo = Math.max(dto.minIntervalSeconds ?? 15, 5);
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
    return campanhas.map((campanha: any) => this.resumoDaCampanha(campanha));
  }

  async detalharCampanha(id: string) {
    const campanha = await this.db().platformOutreachCampaign.findUnique({
      where: { id },
      include: {
        targets: {
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          take: 500,
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
    return {
      ...this.resumoDaCampanha(campanha),
      targets: campanha.targets.map((alvo: any) => ({
        ...alvo,
        phoneFormatted: formatarTelefoneParaExibicao(alvo.phone),
      })),
    };
  }

  private resumoDaCampanha(campanha: any) {
    const pendentes = Math.max(
      campanha.totalTargets - campanha.sentCount - campanha.failedCount,
      0,
    );
    return {
      id: campanha.id,
      name: campanha.name,
      status: campanha.status,
      totalTargets: campanha.totalTargets,
      sentCount: campanha.sentCount,
      repliedCount: campanha.repliedCount,
      failedCount: campanha.failedCount,
      pendingCount: pendentes,
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
    return this.resumoDaCampanha(atualizada);
  }

  async pausar(id: string, motivo = "pausado pela equipe") {
    await this.buscarCampanha(id);
    const campanha = await this.db().platformOutreachCampaign.update({
      where: { id },
      data: { status: OutreachCampaignStatus.PAUSADA, pausedReason: motivo, nextSendAt: null },
    });
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: id });
    return this.resumoDaCampanha(campanha);
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
    return this.resumoDaCampanha(campanha);
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
      const campanhas = await this.db().platformOutreachCampaign.findMany({
        where: { status: OutreachCampaignStatus.ENVIANDO },
        include: { channel: true },
      });
      for (const campanha of campanhas) {
        try {
          await this.avancarCampanha(campanha, agora);
        } catch (error) {
          // Uma campanha com problema não pode parar as outras.
          this.logger.error(
            `Falha ao avançar o disparo ${campanha.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      this.processando = false;
    }
  }

  private async avancarCampanha(campanha: any, agora: Date) {
    if (campanha.nextSendAt && new Date(campanha.nextSendAt).getTime() > agora.getTime()) return;
    if (campanha.respectBusinessHours && !dentroDoHorarioComercial(agora)) return;

    const enviadosHoje = await this.db().platformOutreachTarget.count({
      where: { campaignId: campanha.id, sentAt: { gte: inicioDoDia(agora) } },
    });
    if (enviadosHoje >= campanha.dailyLimit) {
      // Volta amanhã: sem isso o worker giraria a cada 10 segundos batendo no
      // limite e consultando o banco à toa.
      await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: { nextSendAt: proximoDia(agora) },
      });
      return;
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
      return;
    }

    await this.enviarParaAlvo(campanha, alvo);
    await this.db().platformOutreachCampaign.update({
      where: { id: campanha.id },
      data: { nextSendAt: new Date(agora.getTime() + sorteioDeIntervaloMs(campanha)) },
    });
    this.realtime.emitToSuperAdmins("platform.outreach.updated", { campaignId: campanha.id });
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
          attempts: { increment: 1 },
          errorMessage: null,
        },
      });
      await this.db().platformOutreachCampaign.update({
        where: { id: campanha.id },
        data: { sentCount: { increment: 1 } },
      });
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      const tentativas = (alvo.attempts ?? 0) + 1;
      // Uma segunda tentativa cobre queda momentânea do provedor. Além disso, o
      // problema é do número ou da configuração, e insistir só gasta mensagem.
      const desistir = tentativas >= 2;
      await this.db().platformOutreachTarget.update({
        where: { id: alvo.id },
        data: {
          attempts: tentativas,
          errorMessage: mensagem.slice(0, 500),
          ...(desistir ? { status: OutreachTargetStatus.FALHOU } : {}),
        },
      });
      if (desistir) {
        const atualizada = await this.db().platformOutreachCampaign.update({
          where: { id: campanha.id },
          data: { failedCount: { increment: 1 } },
        });
        await this.pausarSeEstiverFalhandoDemais(atualizada, mensagem);
      }
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

function inicioDoDia(momento: Date) {
  const inicio = new Date(momento);
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

function proximoDia(momento: Date) {
  const amanha = inicioDoDia(momento);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(HORA_INICIAL_PADRAO, 0, 0, 0);
  return amanha;
}
