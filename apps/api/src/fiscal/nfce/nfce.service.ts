import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  DiningOrderStatus,
  FiscalDocumentStatus,
  FiscalEmissionType,
  FiscalEnvironment,
  FiscalEventStatus,
  FiscalEventType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  TableSessionStatus,
} from "@prisma/client";
import { create } from "xmlbuilder2";
import { PRISMA_CLIENT } from "../../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../../common/prisma/prisma-client.factory";
import { runsBackgroundJobs } from "../../common/config/app-role";
import { MailService } from "../../common/mail/mail.service";
import { FiscalService } from "../fiscal.service";
import { resolveProductTax } from "../product-tax";
import { calculateTaxes, fromCents, toCents, TaxableItem } from "./tax-engine";
import { buildAccessKey, generateNumericCode } from "./access-key";
import { buildNfceXml, toXmlDate } from "./xml-builder";
import { extractKeyPair, extractDigestValue, signXml } from "./xml-signer";
import { buildQrCode } from "./qr-code";
import { SefazClient, SefazContext, SefazUnavailableError, tagValue } from "./sefaz-client";
import { isAuthorized, isPending, isServiceUnavailable, rejectionGuidance } from "./rejections";
import { buildDanfeHtml, buildDanfeText } from "./danfe";

/**
 * Emissão de NFC-e.
 *
 * A regra que organiza o serviço inteiro: **a venda nunca espera a SEFAZ**. Um
 * restaurante não pode parar a fila porque o servidor estadual está lento, e a
 * própria legislação prevê isso — é para que serve a contingência offline
 * (tpEmis 9): o cupom sai assinado na hora, com aviso, e a transmissão
 * acontece depois, no worker.
 *
 * Por isso o fluxo é sempre: reservar número → montar → assinar → tentar
 * transmitir com timeout curto → se falhar, virar contingência e seguir.
 */

const MAX_TRANSMISSION_ATTEMPTS = 10;
const RETRY_SWEEP_INTERVAL_MS = 60_000;
/** A NFC-e tem janela curta de cancelamento; 30 min é o mais restritivo. */
const CANCEL_WINDOW_MS = 30 * 60 * 1000;

@Injectable()
export class NfceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NfceService.name);
  private sweep?: NodeJS.Timeout;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly fiscal: FiscalService,
    private readonly sefaz: SefazClient,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    if (!runsBackgroundJobs()) return;
    this.sweep = setInterval(() => void this.retryPending(), RETRY_SWEEP_INTERVAL_MS);
    this.sweep.unref();
  }

  onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
  }

  private db() {
    return this.prisma as any;
  }

  // -------------------------------------------------------------------------
  // Emissão
  // -------------------------------------------------------------------------

  /**
   * Emite a NFC-e de um pedido.
   *
   * Idempotente pelo `orderId`: chamar duas vezes devolve o documento
   * existente em vez de emitir outra nota. Sem isso, um duplo clique no caixa
   * geraria duas notas para a mesma venda — e a segunda só se resolve com
   * cancelamento.
  */
  async emitForOrder(companyId: string, orderId: string, options: { customerDocument?: string } = {}) {
    const existente = await this.db().fiscalDocument.findFirst({ where: { orderId, companyId } });
    if (existente && existente.status !== FiscalDocumentStatus.REJEITADA) {
      return this.publicDocument(existente);
    }

    const order = await this.db().order.findFirst({
      // A nota sempre nasce de uma venda recebida. A tela também só lista
      // pedidos pagos, mas a regra fica no serviço para não poder ser burlada
      // por uma chamada direta à API.
      where: {
        id: orderId,
        companyId,
        paymentStatus: PaymentStatus.PAGO,
        status: { not: OrderStatus.CANCELADO },
      },
      include: { items: true, customer: { select: { document: true, name: true } } },
    });
    if (!order) throw new NotFoundException("Pedido pago não encontrado ou já cancelado.");

    const preparado = await this.prepare(companyId, {
      items: order.items.map((item: any) => ({
        productId: item.productId,
        name: item.productName,
        quantity: Number(item.quantity),
        unitPrice: Number(item.totalPrice) / Math.max(1, Number(item.quantity)),
      })),
      deliveryFee: Number(order.deliveryFee),
      discount: Number(order.discount),
      payments: [{ method: order.paymentMethod, amountCents: toCents(Number(order.total)) }],
      customerDocument: options.customerDocument ?? order.customer?.document ?? null,
      customerName: order.customer?.name ?? order.customerName ?? null,
    });

    return this.issue(companyId, preparado, { orderId });
  }

  /** Emite a NFC-e do fechamento de uma comanda de mesa. */
  async emitForTableSession(
    companyId: string,
    tableSessionId: string,
    options: { customerDocument?: string; paymentMethod?: PaymentMethod } = {},
  ) {
    const existente = await this.db().fiscalDocument.findFirst({ where: { tableSessionId, companyId } });
    if (existente && existente.status !== FiscalDocumentStatus.REJEITADA) {
      return this.publicDocument(existente);
    }

    const session = await this.db().tableSession.findFirst({
      where: { id: tableSessionId, companyId, status: TableSessionStatus.FECHADA },
      include: {
        // Apenas o que foi efetivamente servido entra no documento fiscal.
        // Pedido cancelado nunca pode voltar como valor em uma NFC-e.
        orders: {
          where: { status: DiningOrderStatus.SERVIDO },
          include: { items: true },
        },
      },
    });
    if (!session) throw new NotFoundException("Comanda fechada não encontrada.");

    const paymentMethod = options.paymentMethod ?? session.paymentMethod;
    if (!paymentMethod) {
      throw new BadRequestException("Registre a forma de pagamento da mesa antes de emitir a NFC-e.");
    }
    const customerDocument = options.customerDocument ?? session.customerDocument ?? null;
    // Quando a emissão manual completa um dado que faltava no fechamento,
    // guardamos na própria comanda para que uma nova consulta/auditoria use o
    // mesmo contexto, e não uma inferência posterior.
    if (
      paymentMethod !== session.paymentMethod
      || customerDocument !== session.customerDocument
      || !session.paidAt
    ) {
      await this.db().tableSession.updateMany({
        where: { id: tableSessionId, companyId, status: TableSessionStatus.FECHADA },
        data: {
          paymentMethod,
          customerDocument,
          paidAt: session.paidAt ?? new Date(),
        },
      });
    }

    const itens = session.orders.flatMap((pedido: any) => pedido.items.map((item: any) => ({
      productId: item.productId,
      name: item.productName,
      quantity: Number(item.quantity),
      unitPrice: Number(item.totalPrice) / Math.max(1, Number(item.quantity)),
    })));
    if (!itens.length) throw new BadRequestException("A comanda não tem itens para emitir.");

    const totalCents = itens.reduce(
      (soma: number, item: any) => soma + Math.round(toCents(item.unitPrice) * item.quantity),
      0,
    );
    const preparado = await this.prepare(companyId, {
      items: itens,
      payments: [{ method: paymentMethod, amountCents: totalCents }],
      customerDocument,
      customerName: session.customerName ?? null,
    });

    return this.issue(companyId, preparado, { tableSessionId });
  }

  /**
   * Vendas concluídas que ainda não receberam documento fiscal.
   *
   * A lista permite emissão manual tanto para delivery pago quanto para mesas
   * já fechadas, inclusive se a emissão automática estiver desligada. Nunca
   * retornamos fontes que já têm documento: a idempotência fica no servidor,
   * não no botão da tela.
   */
  async listPendingEmissionSources(companyId: string) {
    const [orders, sessions] = await Promise.all([
      this.db().order.findMany({
        where: {
          companyId,
          paymentStatus: PaymentStatus.PAGO,
          status: { not: OrderStatus.CANCELADO },
        },
        select: {
          id: true,
          total: true,
          paymentMethod: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      this.db().tableSession.findMany({
        where: { companyId, status: TableSessionStatus.FECHADA },
        select: {
          id: true,
          paymentMethod: true,
          closedAt: true,
          createdAt: true,
          table: { select: { name: true } },
          orders: {
            where: { status: DiningOrderStatus.SERVIDO },
            select: { subtotal: true },
          },
        },
        orderBy: { closedAt: "desc" },
        take: 60,
      }),
    ]);

    const orderIds = orders.map((order: any) => order.id);
    const tableSessionIds = sessions.map((session: any) => session.id);
    const documents = (orderIds.length || tableSessionIds.length)
      ? await this.db().fiscalDocument.findMany({
        where: {
          companyId,
          OR: [
            ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
            ...(tableSessionIds.length ? [{ tableSessionId: { in: tableSessionIds } }] : []),
          ],
        },
        select: { orderId: true, tableSessionId: true },
      })
      : [];
    const documentedOrderIds = new Set(documents.map((document: any) => document.orderId).filter(Boolean));
    const documentedTableSessionIds = new Set(documents.map((document: any) => document.tableSessionId).filter(Boolean));

    return {
      orders: orders
        .filter((order: any) => !documentedOrderIds.has(order.id))
        .map((order: any) => ({
          kind: "PEDIDO" as const,
          id: order.id,
          label: `Pedido ${order.id.slice(-6).toUpperCase()}`,
          totalAmount: Number(order.total),
          paymentMethod: order.paymentMethod,
          completedAt: order.createdAt,
        })),
      tables: sessions
        .map((session: any) => ({
          kind: "MESA" as const,
          id: session.id,
          label: session.table.name,
          totalAmount: session.orders.reduce((sum: number, order: any) => sum + Number(order.subtotal), 0),
          paymentMethod: session.paymentMethod,
          completedAt: session.closedAt ?? session.createdAt,
        }))
        .filter((session: any) => session.totalAmount > 0 && !documentedTableSessionIds.has(session.id)),
    };
  }

  // -------------------------------------------------------------------------
  // Preparação
  // -------------------------------------------------------------------------

  private async prepare(
    companyId: string,
    input: {
      items: Array<{ productId: string; name: string; quantity: number; unitPrice: number }>;
      deliveryFee?: number;
      discount?: number;
      payments: Array<{ method: PaymentMethod; amountCents: number }>;
      customerDocument: string | null;
      customerName: string | null;
    },
  ) {
    const [profile, company] = await Promise.all([
      this.db().companyFiscalProfile.findUnique({ where: { companyId } }),
      this.db().company.findUnique({ where: { id: companyId }, select: { cnpj: true, phone: true } }),
    ]);
    if (!profile) throw new BadRequestException("Cadastre os dados fiscais da empresa antes de emitir.");
    if (!company?.cnpj) throw new BadRequestException("A empresa precisa de um CNPJ cadastrado para emitir nota.");

    const produtos = await this.db().product.findMany({
      where: { companyId, id: { in: input.items.map((item) => item.productId) } },
    });
    const porId = new Map(produtos.map((produto: any) => [produto.id, produto]));

    // Resolve a tributação de todos antes de emitir. Descobrir na metade que
    // um item está incompleto deixaria a numeração queimada por nada.
    const taxable: TaxableItem[] = [];
    const pendencias: string[] = [];
    for (const item of input.items) {
      const produto = porId.get(item.productId);
      if (!produto) {
        pendencias.push(`Produto ${item.name} não encontrado no cardápio.`);
        continue;
      }
      const resolucao = resolveProductTax(profile, produto as any);
      if (!resolucao.tax) {
        pendencias.push(`${item.name}: ${resolucao.pendencias.join(" ")}`);
        continue;
      }
      taxable.push({ ...item, tax: resolucao.tax });
    }
    if (pendencias.length) {
      throw new BadRequestException(
        `Não é possível emitir a nota — corrija a tributação em Painel > Fiscal. ${pendencias.join(" ")}`,
      );
    }

    const calculo = calculateTaxes(profile.taxRegime, taxable, {
      deliveryFee: input.deliveryFee,
      discount: input.discount,
    });

    return {
      profile,
      emitter: {
        cnpj: company.cnpj,
        legalName: profile.legalName,
        tradeName: profile.tradeName,
        stateRegistration: profile.stateRegistration,
        taxRegime: profile.taxRegime,
        addressStreet: profile.addressStreet,
        addressNumber: profile.addressNumber,
        addressComplement: profile.addressComplement,
        addressDistrict: profile.addressDistrict,
        cityIbgeCode: profile.cityIbgeCode,
        cityName: profile.cityName,
        state: profile.state,
        zipCode: profile.zipCode,
        phone: company.phone,
      },
      calculo,
      payments: input.payments,
      customerDocument: input.customerDocument,
      customerName: input.customerName,
    };
  }

  // -------------------------------------------------------------------------
  // Emissão propriamente dita
  // -------------------------------------------------------------------------

  private async issue(
    companyId: string,
    preparado: Awaited<ReturnType<NfceService["prepare"]>>,
    vinculo: { orderId?: string; tableSessionId?: string },
  ) {
    const { profile, calculo } = preparado;
    const issuedAt = new Date();

    const numero = await this.reserveNumber(companyId, profile.id);
    const numericCode = generateNumericCode(numero);

    // O documento é criado ANTES de qualquer coisa dar errado: número
    // reservado sem registro é buraco silencioso na sequência, e a
    // fiscalização cobra a justificativa de cada número faltante.
    const documento = await this.db().fiscalDocument.create({
      data: {
        companyId,
        ...vinculo,
        status: FiscalDocumentStatus.RASCUNHO,
        environment: profile.environment,
        series: profile.nfceSeries,
        number: numero,
        numericCode,
        issuedAt,
        totalAmount: fromCents(calculo.totals.totalCents),
        icmsAmount: fromCents(calculo.totals.icmsValueCents),
        pisAmount: fromCents(calculo.totals.pisValueCents),
        cofinsAmount: fromCents(calculo.totals.cofinsValueCents),
      },
    });

    try {
      return await this.buildSignAndTransmit(companyId, documento.id, preparado, issuedAt, numericCode, numero);
    } catch (error) {
      if (error instanceof SefazUnavailableError) {
        // Indisponibilidade não é erro do lojista: vira contingência e a
        // venda continua. O worker transmite quando o serviço voltar.
        return this.toContingency(companyId, documento.id, preparado, issuedAt, numericCode, numero, error.message);
      }
      const mensagem = error instanceof Error ? error.message : "Falha ao emitir a nota.";
      await this.db().fiscalDocument.update({
        where: { id: documento.id },
        data: {
          status: FiscalDocumentStatus.REJEITADA,
          statusReason: mensagem,
          actionHint: "Corrija o cadastro e emita novamente; este número precisará ser inutilizado.",
        },
      });
      throw error;
    }
  }

  private async buildSignAndTransmit(
    companyId: string,
    documentId: string,
    preparado: Awaited<ReturnType<NfceService["prepare"]>>,
    issuedAt: Date,
    numericCode: string,
    numero: number,
    emissionType: FiscalEmissionType = FiscalEmissionType.NORMAL,
  ) {
    const { profile, emitter, calculo } = preparado;
    const tpEmis = emissionType === FiscalEmissionType.CONTINGENCIA_OFFLINE ? 9 : 1;

    const accessKey = buildAccessKey({
      uf: emitter.state,
      issuedAt,
      cnpj: emitter.cnpj,
      series: profile.nfceSeries,
      number: numero,
      emissionType: tpEmis,
      numericCode,
    });

    const xml = buildNfceXml({
      accessKey,
      numericCode,
      series: profile.nfceSeries,
      number: numero,
      issuedAt,
      environment: profile.environment,
      emissionType: tpEmis,
      contingencyReason: "Falha na comunicacao com a SEFAZ",
      emitter,
      customer: { document: preparado.customerDocument, name: preparado.customerName },
      items: calculo.items,
      totals: calculo.totals,
      payments: preparado.payments,
    });

    const material = await this.fiscal.loadSigningMaterial(companyId);
    const chaves = extractKeyPair({ pfx: material.pfx, password: material.password });
    const assinado = signXml(xml, `NFe${accessKey}`, "NFe", chaves);

    const csc = await this.fiscal.loadCsc(companyId);
    const qrCodeUrl = buildQrCode({
      accessKey,
      uf: emitter.state,
      environment: profile.environment,
      cscId: csc.cscId,
      cscToken: csc.token,
      emissionType: tpEmis,
      offline: tpEmis === 9
        ? {
          issuedAt,
          totalCents: calculo.totals.totalCents,
          icmsBaseCents: calculo.totals.icmsBaseCents,
          digestValue: extractDigestValue(assinado),
        }
        : undefined,
    });

    await this.db().fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: FiscalDocumentStatus.ASSINADA,
        emissionType,
        accessKey,
        xml: assinado,
        qrCodeUrl,
      },
    });

    if (emissionType === FiscalEmissionType.CONTINGENCIA_OFFLINE) {
      await this.db().fiscalDocument.update({
        where: { id: documentId },
        data: { status: FiscalDocumentStatus.CONTINGENCIA, nextAttemptAt: new Date(Date.now() + 60_000) },
      });
      return this.publicDocument(await this.db().fiscalDocument.findUnique({ where: { id: documentId } }));
    }

    return this.transmit(companyId, documentId, { pfx: material.pfx, password: material.password });
  }

  /**
   * Transmite um documento já assinado.
   *
   * O claim atômico em `attempts` é o mesmo padrão do processamento de eventos
   * Stripe: com o worker rodando e alguém clicando "reenviar" ao mesmo tempo,
   * dois envios simultâneos da mesma nota gerariam duplicidade na SEFAZ.
   */
  async transmit(companyId: string, documentId: string, credentials?: { pfx: Buffer; password: string }) {
    const claimed = await this.db().fiscalDocument.updateMany({
      where: {
        id: documentId,
        status: { in: [FiscalDocumentStatus.ASSINADA, FiscalDocumentStatus.CONTINGENCIA] },
        attempts: { lt: MAX_TRANSMISSION_ATTEMPTS },
      },
      data: { status: FiscalDocumentStatus.ENVIANDO, attempts: { increment: 1 }, nextAttemptAt: null },
    }).catch(() => ({ count: 0 }));

    const documento = await this.db().fiscalDocument.findUnique({ where: { id: documentId } });
    if (!documento) throw new NotFoundException("Documento fiscal não encontrado.");
    if (claimed.count !== 1) {
      if (documento.status === FiscalDocumentStatus.AUTORIZADA) return this.publicDocument(documento);
      throw new ConflictException("Este documento já está sendo transmitido.");
    }

    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    const material = credentials ?? await this.fiscal.loadSigningMaterial(companyId);
    const context: SefazContext = {
      uf: profile.state,
      environment: documento.environment,
      credentials: { pfx: material.pfx, password: material.password },
    };

    let resposta;
    try {
      resposta = await this.sefaz.sendAuthorization(context, documento.xml, documento.id.slice(-15));
    } catch (error) {
      await this.db().fiscalDocument.update({
        where: { id: documentId },
        data: {
          status: FiscalDocumentStatus.CONTINGENCIA,
          statusReason: error instanceof Error ? error.message : "Falha de comunicação.",
          actionHint: "A nota será transmitida automaticamente quando a SEFAZ responder.",
          nextAttemptAt: new Date(Date.now() + this.backoffMs(documento.attempts)),
        },
      });
      throw error;
    }

    // Na resposta síncrona o resultado de negócio vem dentro de protNFe; o
    // cStat do lote (103/104) só diz que a SEFAZ recebeu.
    const protocolo = this.extractProtocol(resposta.xml);
    const codigo = protocolo.code ?? resposta.code;
    const motivo = protocolo.reason ?? resposta.reason;

    if (isAuthorized(codigo)) {
      const atualizado = await this.db().fiscalDocument.update({
        where: { id: documentId },
        data: {
          status: FiscalDocumentStatus.AUTORIZADA,
          statusCode: codigo,
          statusReason: motivo,
          actionHint: null,
          protocolNumber: protocolo.number,
          protocolXml: resposta.xml,
          authorizedAt: new Date(),
          nextAttemptAt: null,
        },
      });
      this.logger.log(`NFC-e ${atualizado.number} autorizada para a empresa ${companyId}.`);
      return this.publicDocument(atualizado);
    }

    if (isPending(codigo) || isServiceUnavailable(codigo)) {
      const atualizado = await this.db().fiscalDocument.update({
        where: { id: documentId },
        data: {
          status: FiscalDocumentStatus.CONTINGENCIA,
          statusCode: codigo,
          statusReason: motivo,
          actionHint: rejectionGuidance(codigo, motivo).hint,
          nextAttemptAt: new Date(Date.now() + this.backoffMs(documento.attempts)),
        },
      });
      return this.publicDocument(atualizado);
    }

    const orientacao = rejectionGuidance(codigo, motivo);
    const atualizado = await this.db().fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: codigo === "301" || codigo === "302" ? FiscalDocumentStatus.DENEGADA : FiscalDocumentStatus.REJEITADA,
        statusCode: codigo,
        statusReason: motivo,
        actionHint: orientacao.hint,
        nextAttemptAt: orientacao.retryable
          ? new Date(Date.now() + this.backoffMs(documento.attempts))
          : null,
      },
    });
    this.logger.warn(`NFC-e ${atualizado.number} rejeitada (${codigo}): ${motivo}`);
    return this.publicDocument(atualizado);
  }

  private async toContingency(
    companyId: string,
    documentId: string,
    preparado: Awaited<ReturnType<NfceService["prepare"]>>,
    issuedAt: Date,
    numericCode: string,
    numero: number,
    motivo: string,
  ) {
    this.logger.warn(`Emitindo em contingência offline: ${motivo}`);
    // A chave muda porque tpEmis entra nela — o documento é reconstruído do
    // zero, não "convertido". Reaproveitar a chave normal produziria uma
    // assinatura sobre conteúdo que não corresponde à chave.
    return this.buildSignAndTransmit(
      companyId,
      documentId,
      preparado,
      issuedAt,
      numericCode,
      numero,
      FiscalEmissionType.CONTINGENCIA_OFFLINE,
    );
  }

  /**
   * Reserva o próximo número da série.
   *
   * `updateMany` condicional em vez de ler-e-gravar: duas vendas simultâneas
   * lendo o mesmo `nfceNextNumber` produziriam duas notas com o mesmo número,
   * e a segunda é rejeitada por duplicidade — com o cliente esperando.
   */
  private async reserveNumber(companyId: string, profileId: string): Promise<number> {
    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const atual = await this.db().companyFiscalProfile.findUnique({ where: { id: profileId } });
      if (!atual) throw new BadRequestException("Cadastro fiscal não encontrado.");
      const numero = atual.nfceNextNumber;
      const claimed = await this.db().companyFiscalProfile.updateMany({
        where: { id: profileId, nfceNextNumber: numero },
        data: { nfceNextNumber: numero + 1 },
      });
      if (claimed.count === 1) return numero;
    }
    throw new ConflictException("Não foi possível reservar a numeração da nota. Tente novamente.");
  }

  private backoffMs(attempts: number) {
    // 1, 2, 4, 8... minutos, com teto de 30. Sem teto, a décima tentativa
    // ficaria a mais de oito horas de distância.
    return Math.min(30, 2 ** Math.max(0, attempts - 1)) * 60_000;
  }

  private extractProtocol(xml: string) {
    const bloco = xml.match(/<protNFe[\s\S]*?<\/protNFe>/)?.[0] ?? "";
    return {
      code: tagValue(bloco, "cStat"),
      reason: tagValue(bloco, "xMotivo"),
      number: tagValue(bloco, "nProt"),
    };
  }

  // -------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------

  /** Reenvia o que ficou em contingência ou falhou de forma recuperável. */
  async retryPending() {
    const pendentes = await this.db().fiscalDocument.findMany({
      where: {
        status: { in: [FiscalDocumentStatus.CONTINGENCIA, FiscalDocumentStatus.ASSINADA] },
        attempts: { lt: MAX_TRANSMISSION_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      take: 20,
      orderBy: { createdAt: "asc" },
      select: { id: true, companyId: true },
    }).catch(() => []);

    for (const documento of pendentes) {
      await this.transmit(documento.companyId, documento.id).catch(() => undefined);
    }

    await this.alertExhausted();
    return pendentes.length;
  }

  /**
   * Nota que esgotou as tentativas para de ser reenviada e sairia da fila em
   * silêncio — com a venda feita e sem documento fiscal. O aviso é o mesmo
   * padrão do dead-letter da cobrança, com claim para não repetir.
   */
  private async alertExhausted() {
    const mortos = await this.db().fiscalDocument.findMany({
      where: {
        status: { in: [FiscalDocumentStatus.CONTINGENCIA, FiscalDocumentStatus.REJEITADA] },
        attempts: { gte: MAX_TRANSMISSION_ATTEMPTS },
        alertedAt: null,
      },
      take: 20,
      include: { company: { select: { name: true } } },
    }).catch(() => []);

    for (const documento of mortos) {
      const claimed = await this.db().fiscalDocument.updateMany({
        where: { id: documento.id, alertedAt: null },
        data: { alertedAt: new Date() },
      }).catch(() => ({ count: 0 }));
      if (claimed.count !== 1) continue;

      await this.mail.sendOperationsAlert(
        "NFC-e não transmitida após todas as tentativas",
        [
          `Empresa: ${documento.company.name} (${documento.companyId})`,
          `Nota: série ${documento.series}, número ${documento.number}`,
          `Chave: ${documento.accessKey ?? "não gerada"}`,
          `Último retorno: ${documento.statusCode ?? "-"} ${documento.statusReason ?? ""}`,
          "A venda foi concluída sem documento fiscal autorizado. Requer ação manual.",
        ],
      ).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Eventos: cancelamento, carta de correção, inutilização
  // -------------------------------------------------------------------------

  /**
   * Cancela uma NFC-e autorizada.
   *
   * A janela é curta e varia por estado; 30 minutos é o valor mais restritivo
   * praticado, então é o que se aplica. Recusar antes de enviar poupa uma
   * rejeição 501 e explica ao lojista o que ele ainda pode fazer.
   */
  async cancel(companyId: string, documentId: string, reason: string, userId: string) {
    const documento = await this.db().fiscalDocument.findFirst({ where: { id: documentId, companyId } });
    if (!documento) throw new NotFoundException("Documento fiscal não encontrado.");
    if (documento.status !== FiscalDocumentStatus.AUTORIZADA) {
      throw new BadRequestException("Só é possível cancelar uma nota autorizada.");
    }
    if (reason.trim().length < 15) {
      throw new BadRequestException("A justificativa do cancelamento precisa de ao menos 15 caracteres.");
    }
    const decorrido = Date.now() - new Date(documento.authorizedAt ?? documento.issuedAt).getTime();
    if (decorrido > CANCEL_WINDOW_MS) {
      throw new BadRequestException(
        "O prazo de cancelamento da NFC-e (30 minutos) já passou. "
        + "Registre a devolução pelo procedimento contábil da sua empresa.",
      );
    }

    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    const material = await this.fiscal.loadSigningMaterial(companyId);
    const chaves = extractKeyPair({ pfx: material.pfx, password: material.password });

    const evento = await this.db().fiscalDocumentEvent.create({
      data: {
        companyId,
        documentId,
        type: FiscalEventType.CANCELAMENTO,
        reason: reason.trim(),
        createdByUserId: userId,
      },
    });

    const xml = this.buildEventXml({
      accessKey: documento.accessKey,
      cnpj: profile.legalName ? (await this.companyCnpj(companyId)) : "",
      uf: profile.state,
      environment: documento.environment,
      eventType: "110111",
      sequence: 1,
      description: "Cancelamento",
      fields: {
        nProt: documento.protocolNumber ?? "",
        xJust: reason.trim(),
      },
    });
    const assinado = signXml(xml, this.eventId(documento.accessKey, "110111", 1), "evento", chaves);

    const resposta = await this.sefaz.sendEvent(
      {
        uf: profile.state,
        environment: documento.environment,
        credentials: { pfx: material.pfx, password: material.password },
      },
      assinado,
      evento.id.slice(-15),
    );

    const bloco = resposta.xml.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? resposta.xml;
    const codigo = tagValue(bloco, "cStat") ?? resposta.code;
    const motivo = tagValue(bloco, "xMotivo") ?? resposta.reason;
    const registrado = codigo === "135" || codigo === "155";

    await this.db().$transaction([
      this.db().fiscalDocumentEvent.update({
        where: { id: evento.id },
        data: {
          status: registrado ? FiscalEventStatus.REGISTRADO : FiscalEventStatus.REJEITADO,
          statusCode: codigo,
          statusReason: motivo,
          protocolNumber: tagValue(bloco, "nProt"),
          xml: assinado,
          protocolXml: resposta.xml,
          registeredAt: registrado ? new Date() : null,
        },
      }),
      ...(registrado
        ? [this.db().fiscalDocument.update({
          where: { id: documentId },
          data: { status: FiscalDocumentStatus.CANCELADA },
        })]
        : []),
    ]);

    if (!registrado) {
      throw new BadRequestException(rejectionGuidance(codigo, motivo).hint);
    }
    return { success: true, protocolNumber: tagValue(bloco, "nProt") };
  }

  /**
   * Carta de correção.
   *
   * A NFC-e aceita CC-e para erros que não mudam valores, partes ou data. A
   * validação aqui é sobre o texto porque o resto a SEFAZ recusa de qualquer
   * forma — e a mensagem dela não explica isso ao lojista.
   */
  async correct(companyId: string, documentId: string, correction: string, userId: string) {
    const documento = await this.db().fiscalDocument.findFirst({ where: { id: documentId, companyId } });
    if (!documento) throw new NotFoundException("Documento fiscal não encontrado.");
    if (documento.status !== FiscalDocumentStatus.AUTORIZADA) {
      throw new BadRequestException("Só é possível corrigir uma nota autorizada.");
    }
    if (correction.trim().length < 15) {
      throw new BadRequestException("A correção precisa de ao menos 15 caracteres.");
    }

    const anteriores = await this.db().fiscalDocumentEvent.count({
      where: { documentId, type: FiscalEventType.CARTA_CORRECAO },
    });
    const sequencia = anteriores + 1;

    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    const material = await this.fiscal.loadSigningMaterial(companyId);
    const chaves = extractKeyPair({ pfx: material.pfx, password: material.password });

    const evento = await this.db().fiscalDocumentEvent.create({
      data: {
        companyId,
        documentId,
        type: FiscalEventType.CARTA_CORRECAO,
        sequence: sequencia,
        reason: correction.trim(),
        createdByUserId: userId,
      },
    });

    const xml = this.buildEventXml({
      accessKey: documento.accessKey,
      cnpj: await this.companyCnpj(companyId),
      uf: profile.state,
      environment: documento.environment,
      eventType: "110110",
      sequence: sequencia,
      description: "Carta de Correcao",
      fields: {
        xCorrecao: correction.trim(),
        xCondUso: "A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, "
          + "de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao "
          + "de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam "
          + "o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da "
          + "operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou "
          + "do destinatario; III - a data de emissao ou de saida.",
      },
    });
    const assinado = signXml(xml, this.eventId(documento.accessKey, "110110", sequencia), "evento", chaves);

    const resposta = await this.sefaz.sendEvent(
      {
        uf: profile.state,
        environment: documento.environment,
        credentials: { pfx: material.pfx, password: material.password },
      },
      assinado,
      evento.id.slice(-15),
    );

    const bloco = resposta.xml.match(/<retEvento[\s\S]*?<\/retEvento>/)?.[0] ?? resposta.xml;
    const codigo = tagValue(bloco, "cStat") ?? resposta.code;
    const motivo = tagValue(bloco, "xMotivo") ?? resposta.reason;
    const registrado = codigo === "135";

    await this.db().fiscalDocumentEvent.update({
      where: { id: evento.id },
      data: {
        status: registrado ? FiscalEventStatus.REGISTRADO : FiscalEventStatus.REJEITADO,
        statusCode: codigo,
        statusReason: motivo,
        protocolNumber: tagValue(bloco, "nProt"),
        xml: assinado,
        protocolXml: resposta.xml,
        registeredAt: registrado ? new Date() : null,
      },
    });

    if (!registrado) throw new BadRequestException(rejectionGuidance(codigo, motivo).hint);
    return { success: true, sequence: sequencia };
  }

  /**
   * Inutiliza uma faixa de numeração.
   *
   * Toda nota rejeitada queima um número, e a fiscalização cobra justificativa
   * de cada buraco na sequência. Sem esta operação a empresa acumula pendência
   * silenciosa até a primeira fiscalização.
   */
  async inutilize(companyId: string, range: { start: number; end: number; reason: string }, userId: string) {
    if (range.end < range.start) throw new BadRequestException("A faixa final não pode ser menor que a inicial.");
    if (range.reason.trim().length < 15) {
      throw new BadRequestException("A justificativa da inutilização precisa de ao menos 15 caracteres.");
    }

    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    if (!profile) throw new BadRequestException("Cadastre os dados fiscais antes de inutilizar numeração.");

    const usados = await this.db().fiscalDocument.count({
      where: {
        companyId,
        environment: profile.environment,
        series: profile.nfceSeries,
        number: { gte: range.start, lte: range.end },
        status: { in: [FiscalDocumentStatus.AUTORIZADA, FiscalDocumentStatus.CANCELADA] },
      },
    });
    if (usados > 0) {
      throw new ConflictException(
        `Há ${usados} nota(s) autorizada(s) nesta faixa. Não é possível inutilizar numeração já usada.`,
      );
    }

    const cnpj = await this.companyCnpj(companyId);
    const material = await this.fiscal.loadSigningMaterial(companyId);
    const chaves = extractKeyPair({ pfx: material.pfx, password: material.password });

    const evento = await this.db().fiscalDocumentEvent.create({
      data: {
        companyId,
        type: FiscalEventType.INUTILIZACAO,
        reason: range.reason.trim(),
        rangeStart: range.start,
        rangeEnd: range.end,
        createdByUserId: userId,
      },
    });

    const ano = String(new Date().getFullYear()).slice(-2);
    const cUF = (await import("./access-key")).UF_CODES[profile.state.toUpperCase()];
    const inutId = `ID${cUF}${ano}${cnpj.padStart(14, "0")}65`
      + `${String(profile.nfceSeries).padStart(3, "0")}`
      + `${String(range.start).padStart(9, "0")}${String(range.end).padStart(9, "0")}`;

    const xml = create({ version: "1.0", encoding: "UTF-8" })
      .ele("inutNFe", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "4.00" })
      .ele("infInut", { Id: inutId })
      .ele("tpAmb").txt(profile.environment === FiscalEnvironment.PRODUCAO ? "1" : "2").up()
      .ele("xServ").txt("INUTILIZAR").up()
      .ele("cUF").txt(cUF).up()
      .ele("ano").txt(ano).up()
      .ele("CNPJ").txt(cnpj).up()
      .ele("mod").txt("65").up()
      .ele("serie").txt(String(profile.nfceSeries)).up()
      .ele("nNFIni").txt(String(range.start)).up()
      .ele("nNFFin").txt(String(range.end)).up()
      .ele("xJust").txt(range.reason.trim()).up()
      .up()
      .up()
      .end({ prettyPrint: false, headless: false });

    const assinado = signXml(xml, inutId, "inutNFe", chaves);
    const resposta = await this.sefaz.sendInutilization(
      {
        uf: profile.state,
        environment: profile.environment,
        credentials: { pfx: material.pfx, password: material.password },
      },
      assinado,
    );

    const registrado = resposta.code === "102";
    await this.db().$transaction([
      this.db().fiscalDocumentEvent.update({
        where: { id: evento.id },
        data: {
          status: registrado ? FiscalEventStatus.REGISTRADO : FiscalEventStatus.REJEITADO,
          statusCode: resposta.code,
          statusReason: resposta.reason,
          protocolNumber: tagValue(resposta.xml, "nProt"),
          xml: assinado,
          protocolXml: resposta.xml,
          registeredAt: registrado ? new Date() : null,
        },
      }),
      this.db().fiscalDocument.updateMany({
        where: {
          companyId,
          environment: profile.environment,
          series: profile.nfceSeries,
          number: { gte: range.start, lte: range.end },
          status: { in: [FiscalDocumentStatus.REJEITADA, FiscalDocumentStatus.RASCUNHO] },
        },
        data: { status: registrado ? FiscalDocumentStatus.INUTILIZADA : FiscalDocumentStatus.REJEITADA },
      }),
    ]);

    if (!registrado) throw new BadRequestException(rejectionGuidance(resposta.code, resposta.reason).hint);
    return { success: true, protocolNumber: tagValue(resposta.xml, "nProt") };
  }

  private eventId(accessKey: string, type: string, sequence: number) {
    return `ID${type}${accessKey}${String(sequence).padStart(2, "0")}`;
  }

  private buildEventXml(input: {
    accessKey: string;
    cnpj: string;
    uf: string;
    environment: FiscalEnvironment;
    eventType: string;
    sequence: number;
    description: string;
    fields: Record<string, string>;
  }) {
    const cUF = require("./access-key").UF_CODES[input.uf.toUpperCase()];
    const evento = create({ version: "1.0", encoding: "UTF-8" })
      .ele("evento", { xmlns: "http://www.portalfiscal.inf.br/nfe", versao: "1.00" })
      .ele("infEvento", { Id: this.eventId(input.accessKey, input.eventType, input.sequence) });

    evento.ele("cOrgao").txt(cUF);
    evento.ele("tpAmb").txt(input.environment === FiscalEnvironment.PRODUCAO ? "1" : "2");
    evento.ele("CNPJ").txt(input.cnpj.replace(/\D/g, ""));
    evento.ele("chNFe").txt(input.accessKey);
    evento.ele("dhEvento").txt(toXmlDate(new Date()));
    evento.ele("tpEvento").txt(input.eventType);
    evento.ele("nSeqEvento").txt(String(input.sequence));
    evento.ele("verEvento").txt("1.00");

    const detEvento = evento.ele("detEvento", { versao: "1.00" });
    detEvento.ele("descEvento").txt(input.description);
    for (const [tag, valor] of Object.entries(input.fields)) detEvento.ele(tag).txt(valor);

    return evento.up().up().end({ prettyPrint: false, headless: false });
  }

  private async companyCnpj(companyId: string) {
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });
    return (company?.cnpj ?? "").replace(/\D/g, "");
  }

  // -------------------------------------------------------------------------
  // Consulta e DANFE
  // -------------------------------------------------------------------------

  async list(companyId: string, filters: { status?: FiscalDocumentStatus; page?: number; pageSize?: number } = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const where: any = { companyId };
    if (filters.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      this.db().fiscalDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db().fiscalDocument.count({ where }),
    ]);
    return {
      items: items.map((item: any) => this.publicDocument(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async findById(companyId: string, documentId: string) {
    const documento = await this.db().fiscalDocument.findFirst({
      where: { id: documentId, companyId },
      include: { events: { orderBy: { createdAt: "desc" } } },
    });
    if (!documento) throw new NotFoundException("Documento fiscal não encontrado.");
    return {
      ...this.publicDocument(documento),
      events: documento.events.map((evento: any) => ({
        id: evento.id,
        type: evento.type,
        status: evento.status,
        reason: evento.reason,
        sequence: evento.sequence,
        protocolNumber: evento.protocolNumber,
        statusReason: evento.statusReason,
        createdAt: evento.createdAt,
      })),
    };
  }

  /** XML autorizado, para o contador. */
  async downloadXml(companyId: string, documentId: string) {
    const documento = await this.db().fiscalDocument.findFirst({ where: { id: documentId, companyId } });
    if (!documento?.xml) throw new NotFoundException("XML não disponível para este documento.");
    return { fileName: `NFe${documento.accessKey ?? documento.id}.xml`, xml: documento.xml };
  }

  /** Cupom para impressão. `format=texto` para térmicas ESC/POS. */
  async danfe(companyId: string, documentId: string, format: "html" | "texto" = "html") {
    const documento = await this.db().fiscalDocument.findFirst({ where: { id: documentId, companyId } });
    if (!documento) throw new NotFoundException("Documento fiscal não encontrado.");
    if (!documento.accessKey || !documento.xml) {
      throw new BadRequestException("A nota ainda não foi montada; não há cupom para imprimir.");
    }

    const [profile, company] = await Promise.all([
      this.db().companyFiscalProfile.findUnique({ where: { companyId } }),
      this.db().company.findUnique({ where: { id: companyId }, select: { cnpj: true, name: true } }),
    ]);

    // Os itens são reconstruídos do XML guardado, não recalculados: o cupom
    // precisa refletir a nota que foi assinada, mesmo que o cardápio tenha
    // mudado desde então.
    const itens = this.itemsFromXml(documento.xml);
    const totais = this.totalsFromXml(documento.xml);

    const input = {
      emitterName: profile?.legalName ?? company?.name ?? "",
      emitterCnpj: company?.cnpj ?? "",
      emitterAddress: profile
        ? `${profile.addressStreet}, ${profile.addressNumber} - ${profile.addressDistrict}, ${profile.cityName}/${profile.state}`
        : "",
      emitterState: profile?.state ?? "",
      environment: documento.environment,
      accessKey: documento.accessKey,
      series: documento.series,
      number: documento.number,
      issuedAt: documento.issuedAt,
      protocolNumber: documento.protocolNumber,
      authorizedAt: documento.authorizedAt,
      qrCodeUrl: documento.qrCodeUrl ?? "",
      items: itens,
      totals: totais,
      payments: this.paymentsFromXml(documento.xml),
      customerDocument: this.customerFromXml(documento.xml),
      offline: documento.emissionType === FiscalEmissionType.CONTINGENCIA_OFFLINE
        && documento.status !== FiscalDocumentStatus.AUTORIZADA,
    };

    return format === "texto"
      ? { contentType: "text/plain; charset=utf-8", body: buildDanfeText(input as any) }
      : { contentType: "text/html; charset=utf-8", body: buildDanfeHtml(input as any) };
  }

  private itemsFromXml(xml: string) {
    const blocos = xml.match(/<det nItem="\d+">[\s\S]*?<\/det>/g) ?? [];
    return blocos.map((bloco) => ({
      productId: tagValue(bloco, "cProd") ?? "",
      name: tagValue(bloco, "xProd") ?? "",
      quantity: Number(tagValue(bloco, "qCom") ?? 0),
      unitPriceCents: Math.round(Number(tagValue(bloco, "vUnCom") ?? 0) * 100),
      totalCents: Math.round(Number(tagValue(bloco, "vProd") ?? 0) * 100),
    }));
  }

  private totalsFromXml(xml: string) {
    const bloco = xml.match(/<ICMSTot>[\s\S]*?<\/ICMSTot>/)?.[0] ?? "";
    const cents = (tag: string) => Math.round(Number(tagValue(bloco, tag) ?? 0) * 100);
    return {
      productsCents: cents("vProd"),
      deliveryCents: cents("vFrete"),
      discountCents: cents("vDesc"),
      totalCents: cents("vNF"),
      icmsBaseCents: cents("vBC"),
      icmsValueCents: cents("vICMS"),
      pisValueCents: cents("vPIS"),
      cofinsValueCents: cents("vCOFINS"),
      approximateTaxCents: cents("vTotTrib"),
    };
  }

  private paymentsFromXml(xml: string) {
    const blocos = xml.match(/<detPag>[\s\S]*?<\/detPag>/g) ?? [];
    const rotulos: Record<string, string> = { "01": "Dinheiro", "03": "Cartão de crédito", "04": "Cartão de débito", "17": "Pix", "99": "Outros" };
    return blocos.map((bloco) => ({
      label: rotulos[tagValue(bloco, "tPag") ?? "99"] ?? "Outros",
      amountCents: Math.round(Number(tagValue(bloco, "vPag") ?? 0) * 100),
    }));
  }

  private customerFromXml(xml: string) {
    const bloco = xml.match(/<dest>[\s\S]*?<\/dest>/)?.[0] ?? "";
    return tagValue(bloco, "CPF") ?? tagValue(bloco, "CNPJ");
  }

  /** Nunca devolve o XML inteiro na listagem — é grande e pouco útil na tela. */
  private publicDocument(documento: any) {
    return {
      id: documento.id,
      orderId: documento.orderId,
      tableSessionId: documento.tableSessionId,
      status: documento.status,
      emissionType: documento.emissionType,
      environment: documento.environment,
      series: documento.series,
      number: documento.number,
      accessKey: documento.accessKey,
      issuedAt: documento.issuedAt,
      authorizedAt: documento.authorizedAt,
      protocolNumber: documento.protocolNumber,
      totalAmount: Number(documento.totalAmount),
      qrCodeUrl: documento.qrCodeUrl,
      statusCode: documento.statusCode,
      statusReason: documento.statusReason,
      actionHint: documento.actionHint,
      attempts: documento.attempts,
      createdAt: documento.createdAt,
    };
  }
}
