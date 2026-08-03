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
import { FiscalCertificateStatus, FiscalEnvironment, Role, TaxRegime } from "@prisma/client";
import {
  CFOP_OPTIONS,
  PIS_COFINS_CST_OPTIONS,
  UNIT_OPTIONS,
  isValidCode,
  isValidIcmsCode,
} from "@chegowia/shared";
import { MailService } from "../common/mail/mail.service";
import { runsBackgroundJobs } from "../common/config/app-role";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { FiscalSecretsService } from "./fiscal-secrets.service";
import { readCertificate } from "./certificate-reader";
import { resolveProductTax } from "./product-tax";
import { UpdateFiscalProfileDto } from "./dto/update-fiscal-profile.dto";

/** Um .pfx real tem alguns KB; o teto corta arquivo trocado por engano. */
export const MAX_CERTIFICATE_BYTES = 512 * 1024;

/** Janela de aviso antes do vencimento do certificado. */
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;

/** Intervalo mínimo entre dois avisos sobre o mesmo certificado. */
const EXPIRY_ALERT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const EXPIRY_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class FiscalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FiscalService.name);
  private expirySweep?: NodeJS.Timeout;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly secrets: FiscalSecretsService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    // Mesma regra dos demais jobs: só o processo worker executa.
    if (!runsBackgroundJobs()) return;
    this.expirySweep = setInterval(() => void this.alertExpiringCertificates(), EXPIRY_SWEEP_INTERVAL_MS);
    this.expirySweep.unref();
  }

  onModuleDestroy() {
    if (this.expirySweep) clearInterval(this.expirySweep);
  }

  private db() {
    return this.prisma as any;
  }

  /**
   * Situação fiscal da empresa. Nunca devolve o certificado nem o CSC — só se
   * estão presentes e até quando valem, que é o que a tela precisa mostrar.
   */
  async getProfile(companyId: string) {
    const [profile, certificate, produtos] = await Promise.all([
      this.db().companyFiscalProfile.findUnique({ where: { companyId } }),
      this.activeCertificate(companyId),
      this.listProductTaxStatus(companyId, { onlyPending: true }),
    ]);

    return {
      profile: profile ? this.publicProfile(profile) : null,
      certificate: certificate ? this.publicCertificate(certificate) : null,
      products: { total: produtos.total, pending: produtos.pending },
      readiness: this.readiness(profile, certificate, produtos.pending),
    };
  }

  async upsertProfile(companyId: string, dto: UpdateFiscalProfileDto) {
    const { cscToken, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (cscToken) data.cscTokenEncrypted = this.secrets.encrypt(cscToken);

    // CSOSN e CST passam os dois num campo de dígitos; o que distingue é o
    // regime. Sem esta checagem o erro só aparece na rejeição da SEFAZ.
    if (dto.defaultIcmsCode && !isValidIcmsCode(dto.taxRegime as never, dto.defaultIcmsCode)) {
      throw new BadRequestException(
        dto.taxRegime === TaxRegime.REGIME_NORMAL
          ? `${dto.defaultIcmsCode} não é um CST de ICMS válido. No regime normal use CST, não CSOSN.`
          : `${dto.defaultIcmsCode} não é um CSOSN válido. No Simples Nacional use CSOSN, não CST.`,
      );
    }
    for (const [rotulo, codigo] of [
      ["CFOP", dto.defaultCfop],
      ["unidade", dto.defaultUnit],
    ] as const) {
      if (!codigo) continue;
      const tabela = rotulo === "CFOP" ? CFOP_OPTIONS : UNIT_OPTIONS;
      if (!isValidCode(tabela, codigo)) {
        throw new BadRequestException(`${codigo} não é um(a) ${rotulo} reconhecido(a).`);
      }
    }
    for (const [rotulo, codigo] of [
      ["PIS", dto.defaultPisCode],
      ["COFINS", dto.defaultCofinsCode],
    ] as const) {
      if (codigo && !isValidCode(PIS_COFINS_CST_OPTIONS, codigo)) {
        throw new BadRequestException(`${codigo} não é um CST de ${rotulo} válido.`);
      }
    }

    const existing = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });

    // Trocar para produção sem certificado válido e sem CSC produziria uma
    // rejeição na SEFAZ no primeiro pedido do dia, com o cliente esperando.
    if (dto.environment === FiscalEnvironment.PRODUCAO) {
      await this.assertReadyForProduction(companyId, {
        cscId: dto.cscId ?? existing?.cscId ?? null,
        hasCscToken: Boolean(cscToken || existing?.cscTokenEncrypted),
      });
    }

    const saved = existing
      ? await this.db().companyFiscalProfile.update({ where: { companyId }, data })
      : await this.db().companyFiscalProfile.create({ data: { ...data, companyId } });

    return this.publicProfile(saved);
  }

  /**
   * Guarda o certificado A1 cifrado e marca o anterior como substituído.
   *
   * O arquivo não passa pelo disco em momento nenhum: chega em memória pelo
   * multipart, é lido para extrair os metadados e vai cifrado direto para o
   * banco. O histórico é preservado porque documentos já emitidos foram
   * assinados pelo certificado antigo e a auditoria precisa saber por qual.
   */
  async uploadCertificate(
    companyId: string,
    userId: string,
    file: { originalname?: string; buffer?: Buffer; size?: number } | undefined,
    password: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException("Envie o arquivo do certificado (.pfx ou .p12).");
    if (file.buffer.length > MAX_CERTIFICATE_BYTES) {
      throw new BadRequestException("O arquivo é grande demais para um certificado A1.");
    }
    const name = file.originalname ?? "certificado";
    if (!/\.(pfx|p12)$/i.test(name)) {
      throw new BadRequestException("O certificado A1 deve ser um arquivo .pfx ou .p12.");
    }

    const metadata = readCertificate(file.buffer, password);
    if (metadata.notAfter.getTime() <= Date.now()) {
      throw new BadRequestException(
        `Este certificado venceu em ${metadata.notAfter.toLocaleDateString("pt-BR")}. Envie um certificado válido.`,
      );
    }

    // O certificado precisa ser da empresa: enviar o de outro CNPJ produziria
    // uma assinatura válida em nome de terceiro.
    const company = await this.db().company.findUnique({
      where: { id: companyId },
      select: { cnpj: true },
    });
    const companyDocument = company?.cnpj?.replace(/\D/g, "");
    if (metadata.document && companyDocument && metadata.document !== companyDocument) {
      throw new ConflictException(
        "O CNPJ do certificado não corresponde ao CNPJ da empresa.",
      );
    }

    const contentEncrypted = this.secrets.encrypt(file.buffer);
    const passwordEncrypted = this.secrets.encrypt(password);

    const created = await this.db().$transaction(async (tx: any) => {
      await tx.fiscalCertificate.updateMany({
        where: { companyId, status: FiscalCertificateStatus.ATIVO },
        data: { status: FiscalCertificateStatus.SUBSTITUIDO },
      });
      return tx.fiscalCertificate.create({
        data: {
          companyId,
          fileName: name,
          contentEncrypted,
          passwordEncrypted,
          subjectName: metadata.subjectName,
          issuerName: metadata.issuerName,
          serialNumber: metadata.serialNumber,
          notBefore: metadata.notBefore,
          notAfter: metadata.notAfter,
          status: FiscalCertificateStatus.ATIVO,
          uploadedByUserId: userId,
        },
      });
    });

    this.logger.log(`Certificado A1 atualizado para a empresa ${companyId}, válido até ${metadata.notAfter.toISOString()}.`);
    return this.publicCertificate(created);
  }

  /**
   * Material de assinatura em claro. Só para o emissor de NFC-e — nunca deve
   * ser exposto por controller.
   */
  async loadSigningMaterial(companyId: string) {
    const certificate = await this.activeCertificate(companyId);
    if (!certificate) throw new NotFoundException("Nenhum certificado digital ativo para esta empresa.");
    if (certificate.notAfter.getTime() <= Date.now()) {
      throw new BadRequestException("O certificado digital da empresa está vencido.");
    }
    return {
      pfx: this.secrets.decryptToBuffer(certificate.contentEncrypted),
      password: this.secrets.decrypt(certificate.passwordEncrypted),
      notAfter: certificate.notAfter,
    };
  }

  /** CSC em claro, usado só na montagem do QR Code da NFC-e. */
  async loadCsc(companyId: string) {
    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    if (!profile?.cscId || !profile.cscTokenEncrypted) {
      throw new NotFoundException("A empresa ainda não cadastrou o CSC.");
    }
    return { cscId: profile.cscId, token: this.secrets.decrypt(profile.cscTokenEncrypted) };
  }

  /**
   * Avisa o lojista antes do certificado vencer.
   *
   * Certificado A1 vale um ano e vence sem avisar ninguém: o restaurante
   * descobre no meio do expediente, quando a primeira nota é rejeitada. A
   * varredura roda no worker e é consultada por `notAfter`, que está em claro
   * no banco justamente para não precisar decifrar nada aqui.
   *
   * O reenvio é limitado por `expiryAlertedAt`: um aviso por semana até a
   * renovação, em vez de um a cada seis horas.
   */
  async alertExpiringCertificates() {
    const limite = new Date(Date.now() + CERTIFICATE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
    const cooldown = new Date(Date.now() - EXPIRY_ALERT_COOLDOWN_MS);

    const certificados = await this.db().fiscalCertificate.findMany({
      where: {
        status: FiscalCertificateStatus.ATIVO,
        notAfter: { lte: limite },
        OR: [{ expiryAlertedAt: null }, { expiryAlertedAt: { lt: cooldown } }],
      },
      take: 100,
      orderBy: { notAfter: "asc" },
      include: { company: { select: { id: true, name: true } } },
    }).catch(() => []);

    for (const certificado of certificados) {
      // Claim antes de enviar: com duas rodadas concorrentes, só uma avisa.
      const claimed = await this.db().fiscalCertificate.updateMany({
        where: {
          id: certificado.id,
          OR: [{ expiryAlertedAt: null }, { expiryAlertedAt: { lt: cooldown } }],
        },
        data: { expiryAlertedAt: new Date() },
      }).catch(() => ({ count: 0 }));
      if (claimed.count !== 1) continue;

      const dias = this.daysUntil(certificado.notAfter);
      const vencido = dias <= 0;
      const assunto = vencido
        ? "Certificado digital vencido"
        : `Certificado digital vence em ${dias} dia(s)`;
      const linhas = [
        `Empresa: ${certificado.company.name}`,
        `Titular: ${certificado.subjectName}`,
        `Validade: ${certificado.notAfter.toLocaleDateString("pt-BR")}`,
        vencido
          ? "A emissão de notas está bloqueada até o envio de um certificado válido."
          : "Renove junto à sua certificadora e envie o novo arquivo em Painel > Fiscal.",
      ];

      const destinatarios = await this.db().user.findMany({
        where: { companyId: certificado.companyId, role: Role.ADMIN, isActive: true },
        select: { email: true },
      }).catch(() => []);

      for (const destinatario of destinatarios) {
        await this.mail.sendFiscalAlert(destinatario.email, assunto, linhas).catch((error: unknown) => {
          this.logger.error(
            `Não foi possível avisar ${destinatario.email} sobre o certificado ${certificado.id}.`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
      this.logger.warn(`${assunto} — empresa ${certificado.companyId}.`);
    }
    return certificados.length;
  }

  /**
   * Situação fiscal do cardápio: quais produtos ainda não podem sair numa
   * nota e por quê.
   *
   * Existe porque a pendência de um produto é invisível até a venda acontecer.
   * O lojista precisa conseguir olhar a lista antes de ligar a emissão, e não
   * descobrir item a item no balcão.
   */
  async listProductTaxStatus(companyId: string, options: { onlyPending?: boolean } = {}) {
    const profile = await this.db().companyFiscalProfile.findUnique({ where: { companyId } });
    const produtos = await this.db().product.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ncm: true,
        cest: true,
        cfop: true,
        taxOrigin: true,
        icmsCode: true,
        icmsRate: true,
        pisCode: true,
        pisRate: true,
        cofinsCode: true,
        cofinsRate: true,
        unit: true,
      },
    });

    const itens = produtos.map((produto: any) => {
      const resolucao = resolveProductTax(profile, produto);
      return {
        id: produto.id,
        name: produto.name,
        ready: resolucao.pendencias.length === 0,
        pendencias: resolucao.pendencias,
        herdados: resolucao.herdados,
        tax: resolucao.tax,
      };
    });

    const pendentes = itens.filter((item: any) => !item.ready);
    return {
      total: itens.length,
      pending: pendentes.length,
      items: options.onlyPending ? pendentes : itens,
    };
  }

  /** Tributação de um item específico, usada pelo emissor de NFC-e. */
  async resolveTaxForProduct(companyId: string, productId: string) {
    const [profile, produto] = await Promise.all([
      this.db().companyFiscalProfile.findUnique({ where: { companyId } }),
      this.db().product.findFirst({ where: { id: productId, companyId } }),
    ]);
    if (!produto) throw new NotFoundException("Produto não encontrado.");
    return resolveProductTax(profile, produto);
  }

  private activeCertificate(companyId: string) {
    return this.db().fiscalCertificate.findFirst({
      where: { companyId, status: FiscalCertificateStatus.ATIVO },
      orderBy: { createdAt: "desc" },
    });
  }

  private async assertReadyForProduction(
    companyId: string,
    csc: { cscId: string | null; hasCscToken: boolean },
  ) {
    const certificate = await this.activeCertificate(companyId);
    const faltando: string[] = [];
    if (!certificate) faltando.push("certificado digital A1");
    else if (certificate.notAfter.getTime() <= Date.now()) faltando.push("certificado digital válido");
    if (!csc.cscId || !csc.hasCscToken) faltando.push("CSC (identificador e token)");
    if (faltando.length) {
      throw new BadRequestException(
        `Para emitir em produção falta cadastrar: ${faltando.join(", ")}.`,
      );
    }
  }

  private readiness(profile: any, certificate: any, produtosPendentes = 0) {
    const pendencias: string[] = [];
    if (!profile) pendencias.push("Cadastro fiscal não preenchido.");
    if (produtosPendentes > 0) {
      pendencias.push(`${produtosPendentes} produto(s) sem tributação completa.`);
    }
    if (!certificate) pendencias.push("Certificado digital A1 não enviado.");
    else if (certificate.notAfter.getTime() <= Date.now()) pendencias.push("Certificado digital vencido.");
    else if (this.daysUntil(certificate.notAfter) <= CERTIFICATE_EXPIRY_WARNING_DAYS) {
      pendencias.push(`Certificado digital vence em ${this.daysUntil(certificate.notAfter)} dia(s).`);
    }
    if (profile && (!profile.cscId || !profile.cscTokenEncrypted)) pendencias.push("CSC não cadastrado.");
    if (!this.secrets.isConfigured()) pendencias.push("FISCAL_ENCRYPTION_KEY não configurada no servidor.");
    return {
      canEmitInProduction: pendencias.length === 0 && profile?.environment === FiscalEnvironment.PRODUCAO,
      pendencias,
    };
  }

  private daysUntil(date: Date) {
    return Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }

  /** Sem `cscTokenEncrypted`: segredo não sai da camada de serviço. */
  private publicProfile(profile: any) {
    const { cscTokenEncrypted, ...rest } = profile;
    return { ...rest, hasCscToken: Boolean(cscTokenEncrypted) };
  }

  /** Sem o arquivo e sem a senha: a tela só precisa de titular e validade. */
  private publicCertificate(certificate: any) {
    return {
      id: certificate.id,
      fileName: certificate.fileName,
      subjectName: certificate.subjectName,
      issuerName: certificate.issuerName,
      serialNumber: certificate.serialNumber,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      status: certificate.status,
      daysUntilExpiry: this.daysUntil(certificate.notAfter),
      createdAt: certificate.createdAt,
    };
  }
}
