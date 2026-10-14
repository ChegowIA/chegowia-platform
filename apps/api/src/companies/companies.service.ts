import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Role, SubscriptionStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { slugify } from "../common/utils/slugify";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { CreateCompanyAdminDto } from "./dto/create-company-admin.dto";
import { BillingService } from "../billing/billing.service";
import { UpdateCompanySettingsDto } from "./dto/update-company-settings.dto";
import { normalizeBrazilDocument } from "../common/validators/brazil-document.validator";
import { AuthService } from "../auth/auth.service";
import { isStoreOpen } from "../common/utils/store-hours";
import { LocalStorageService } from "../common/storage/local-storage.service";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { filtroPublicoDeEmpresa } from "../common/public-visibility/subscription-grace";
import { LegacyTestDataService } from "../common/legacy-test-data/legacy-test-data.service";
import { isReservedDemoEmail } from "../common/security/reserved-demo-account";
import { normalizePostalCode, PostalCodeLocationService } from "../common/geography/postal-code-location.service";
import { confirmedLocationPatch } from "../common/geography/confirmed-location";
import { CreateUnitDto } from "./dto/create-unit.dto";
import { tenantContext } from "../common/tenant/tenant-context";

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly auth: AuthService,
    private readonly storage: LocalStorageService,
    private readonly postalCodeLocations: PostalCodeLocationService,
    // Opcional apenas para manter testes unitários que instanciam o serviço
    // diretamente. No app real o módulo global sempre o injeta.
    private readonly legacyTestData?: LegacyTestDataService,
    // Idem: opcional para os testes que instanciam o serviço direto.
    private readonly billing?: BillingService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  private async uniqueSlug(base: string): Promise<string> {
    const root = slugify(base) || "empresa";
    let candidate = root;
    let attempt = 1;
    // volume baixo (criação de empresa é ação rara de SUPER_ADMIN) — loop simples é suficiente.
    while (await this.db().company.findUnique({ where: { slug: candidate } })) {
      attempt += 1;
      candidate = `${root}-${attempt}`;
    }
    return candidate;
  }

  /**
   * Uma unidade é outra Company/tenant, não um departamento da matriz.
   * Nenhum pedido, funcionário, produto, canal WhatsApp ou saldo é copiado.
   * Só opções iniciais e o plano são reaproveitados; a assinatura é nova.
   */
  async createUnit(identity: JwtPayload, dto: CreateUnitDto) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || user.role !== Role.ADMIN || identity.assumed || !user.isActive) {
      throw new BadRequestException("Somente o administrador titular pode cadastrar unidades.");
    }
    const source = await this.db().company.findFirst({
      where: { id: identity.companyId ?? "", OR: [{ id: user.companyId ?? "" }, { ownerUserId: user.id }] },
      include: { settings: true, subscription: { include: { plan: true } } },
    });
    if (!source?.subscription?.plan) throw new BadRequestException("A empresa atual precisa ter um plano antes de cadastrar unidades.");
    if (!source.ownerUserId) {
      const admins = await this.db().user.findMany({
        where: { companyId: source.id, role: Role.ADMIN, isActive: true },
        select: { id: true }, take: 2,
      });
      if (admins.length !== 1 || admins[0].id !== user.id) {
        throw new BadRequestException("Não foi possível identificar com segurança o titular da matriz. Solicite à ChegowIA a definição do responsável antes de criar unidades.");
      }
      await this.db().company.updateMany({ where: { id: source.id, ownerUserId: null }, data: { ownerUserId: user.id } });
      const claimed = await this.db().company.findUnique({ where: { id: source.id }, select: { ownerUserId: true } });
      if (claimed?.ownerUserId !== user.id) throw new BadRequestException("O titular da matriz mudou. Recarregue a página.");
      source.ownerUserId = user.id;
    }
    if (source.ownerUserId && source.ownerUserId !== user.id) {
      throw new BadRequestException("O administrador desta unidade não pode criar outras unidades. Solicite ao titular da matriz.");
    }
    const isDemoFamily = source.isTestOnly
      && (source.slug === "operacao-demo-chegowia" || Boolean(source.demoRootCompanyId));
    if (source.isTestOnly && !isDemoFamily) {
      throw new BadRequestException("Esta empresa de teste não pode cadastrar unidades.");
    }
    if (isReservedDemoEmail(user.email) && !isDemoFamily) {
      throw new BadRequestException("Esta conta de demonstração não pode criar unidades comerciais.");
    }
    const adminEmail = dto.adminEmail.trim().toLowerCase();
    if (isReservedDemoEmail(adminEmail) || adminEmail === user.email.toLowerCase()) {
      throw new BadRequestException("Informe o e-mail real e exclusivo do administrador da unidade.");
    }
    if (await this.db().user.findUnique({ where: { email: adminEmail } })) {
      throw new ConflictException("Este e-mail já possui uma conta. Use outro endereço para o administrador da unidade.");
    }
    const cnpj = dto.cnpj ? normalizeBrazilDocument(dto.cnpj) : null;
    if (!cnpj && !isDemoFamily) {
      throw new BadRequestException("Informe o CNPJ próprio deste estabelecimento.");
    }
    const registrationOwner = cnpj ? await this.db().identityDocument.findUnique({ where: { value: cnpj } }) : null;
    const existingRegistration = cnpj ? await this.db().company.findFirst({
      where: { cnpj, ...(registrationOwner?.ownerType === "COMPANY" ? { id: registrationOwner.ownerId } : {}) },
    }) : null;
    const conflictingUser = cnpj ? await this.db().user.findUnique({ where: { document: cnpj } }) : null;
    if (conflictingUser || (registrationOwner && registrationOwner.ownerType !== "COMPANY")) {
      throw new ConflictException("Este CNPJ pertence a outra conta.");
    }
    const reuseRegistration = Boolean(existingRegistration);
    if (reuseRegistration) {
      const owned = existingRegistration.id === user.companyId || existingRegistration.ownerUserId === user.id;
      const samePlace = existingRegistration.zipCode === dto.zipCode
        && normalizeAddress(existingRegistration.addressLine) === normalizeAddress(dto.addressLine)
        && normalizeAddress(existingRegistration.city) === normalizeAddress(dto.city)
        && existingRegistration.state?.toUpperCase() === dto.state.toUpperCase();
      if (!owned || !samePlace || !dto.shareCnpj) {
        throw new ConflictException("O mesmo CNPJ completo só pode ser reutilizado em outra operação do titular no mesmo endereço físico.");
      }
    } else if (dto.shareCnpj || registrationOwner) {
      throw new ConflictException("Este CNPJ não pode ser reutilizado nesta unidade.");
    }
    const slug = await this.uniqueSlug(dto.name);
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    try {
      const unit = await this.db().$transaction(async (tx: any) => {
        const company = await tx.company.create({
          data: {
            ownerUserId: user.id,
            name: dto.name,
            slug,
            cnpj,
            phone: dto.phone,
            addressLine: dto.addressLine,
            city: dto.city,
            state: dto.state,
            zipCode: dto.zipCode,
            // O ponto exato deve ser confirmado no mapa em Configurações.
            locationConfirmedAt: null,
            deliveryFeeBase: source.deliveryFeeBase,
            deliveryFeePerKm: source.deliveryFeePerKm,
            deliveryRadiusKm: source.deliveryRadiusKm,
            avgDeliveryTimeMinutes: source.avgDeliveryTimeMinutes,
            logoUrl: source.logoUrl,
            isTestOnly: Boolean(source.isTestOnly),
            demoRootCompanyId: isDemoFamily ? source.demoRootCompanyId ?? source.id : null,
            isPublished: false,
            settings: { create: {
              plan: source.subscription.plan.slug,
              openingHours: source.settings?.openingHours ?? undefined,
              paymentMethodsEnabled: source.settings?.paymentMethodsEnabled ?? undefined,
              pickupEnabled: source.settings?.pickupEnabled ?? true,
            } },
          },
        });
        if (cnpj && !reuseRegistration) await tx.identityDocument.create({
          data: { value: cnpj, ownerType: "COMPANY", ownerId: company.id },
        });
        await tx.clientSubscription.create({
          data: {
            companyId: company.id,
            planId: source.subscription.plan.id,
            monthlyPriceSnapshot: isDemoFamily ? 0 : source.subscription.plan.monthlyPrice,
            status: isDemoFamily ? SubscriptionStatus.ATIVA : SubscriptionStatus.EM_TESTE,
            trialStartedAt: isDemoFamily ? null : now,
            trialEndsAt: isDemoFamily ? null : trialEndsAt,
          },
        });
        const admin = await tx.user.create({
          data: {
            name: dto.adminName.trim(),
            email: adminEmail,
            passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
            role: Role.ADMIN,
            companyId: company.id,
            employeeProfile: { create: { companyId: company.id, position: "Administrador" } },
          },
          select: { id: true, email: true },
        });
        return { company, admin };
      });
      this.postalCodeLocations.warm(unit.company.zipCode, { city: unit.company.city, state: unit.company.state });
      const invitationSent = await this.auth.inviteUnitAdmin(unit.admin.id, unit.company.name);
      return { id: unit.company.id, name: unit.company.name, slug: unit.company.slug,
        trialEndsAt: isDemoFamily ? null : trialEndsAt,
        adminEmail: unit.admin.email, invitationSent,
        message: invitationSent
          ? "Unidade criada. O administrador recebeu um convite para definir a senha; confirme o ponto no mapa antes de receber pedidos."
          : "Unidade criada, mas o convite não pôde ser enviado. Reenvie-o pela página de unidades." };
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ConflictException("Este CNPJ ou nome de loja já está em uso.");
      throw error;
    }
  }

  async resendUnitAdminInvitation(identity: JwtPayload, id: string) {
    if (identity.role !== Role.ADMIN || identity.assumed) {
      throw new BadRequestException("Somente o titular da matriz pode reenviar este convite.");
    }
    const company = await this.db().company.findFirst({
      where: { id, ownerUserId: identity.sub },
      select: { id: true, name: true, users: { where: { role: Role.ADMIN },
        orderBy: { createdAt: "asc" }, select: { id: true, email: true, emailVerifiedAt: true } } },
    });
    if (!company) throw new NotFoundException("Unidade não encontrada.");
    const admin = company.users.find((candidate: any) => candidate.id !== identity.sub);
    if (!admin || admin.emailVerifiedAt) throw new BadRequestException("O administrador já ativou a conta ou não existe.");
    const invitationSent = await this.auth.inviteUnitAdmin(admin.id, company.name);
    return { adminEmail: admin.email, invitationSent };
  }

  async setUnitPublished(identity: JwtPayload, id: string, published: boolean) {
    const user = await this.db().user.findUnique({ where: { id: identity.sub } });
    if (!user || user.role !== Role.ADMIN || identity.assumed || typeof published !== "boolean") {
      throw new BadRequestException("Esta conta não pode alterar a publicação da unidade.");
    }
    const company = await this.db().company.findFirst({
      where: { id, OR: [{ id: user.companyId ?? "" }, { ownerUserId: user.id }] },
      include: { subscription: true },
    });
    if (!company) throw new NotFoundException("Unidade não encontrada.");
    if (published) {
      if (!company.isActive || !company.locationConfirmedAt || company.latitude == null || company.longitude == null) {
        throw new BadRequestException("Confirme no mapa o ponto de saída desta unidade antes de publicá-la.");
      }
      const hasProduct = await tenantContext.runAsCompany(id, async () => await this.db().product.findFirst({
        where: { companyId: id, isActive: true, category: { isActive: true } }, select: { id: true },
      }));
      if (!hasProduct) throw new BadRequestException("Cadastre ao menos um produto ativo antes de publicar esta unidade.");
      const subscription = company.subscription;
      const entitled = subscription?.status === SubscriptionStatus.ATIVA
        || (subscription?.status === SubscriptionStatus.EM_TESTE && subscription.trialEndsAt > new Date());
      if (!entitled) throw new BadRequestException("Ative a assinatura desta unidade antes de publicá-la.");
    }
    return this.db().company.update({ where: { id }, data: { isPublished: published },
      select: { id: true, isPublished: true } });
  }

  async create(dto: CreateCompanyDto) {
    const slug = dto.slug ? slugify(dto.slug) : await this.uniqueSlug(dto.name);
    const zipCode = normalizePostalCode(dto.zipCode);
    if (!zipCode) {
      throw new BadRequestException("Informe o CEP operacional da empresa antes de criar o cadastro.");
    }
    const cnpj = dto.cnpj ? normalizeBrazilDocument(dto.cnpj) : null;
    if (cnpj) {
      const [company, user] = await Promise.all([
        this.db().company.findFirst({ where: { cnpj } }),
        this.db().user.findUnique({ where: { document: cnpj } }),
      ]);
      if (company || user) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
    }
    try {
      const company = await this.db().$transaction(async (tx: any) => {
        const company = await tx.company.create({
          data: {
            name: dto.name,
            slug,
            cnpj,
            phone: dto.phone,
            whatsapp: dto.whatsapp,
            addressLine: dto.addressLine,
            city: dto.city,
            state: dto.state,
            zipCode,
            ...confirmedLocationPatch(dto, false),
            deliveryFeeBase: dto.deliveryFeeBase ?? 0,
            deliveryFeePerKm: dto.deliveryFeePerKm ?? 1.5,
            deliveryRadiusKm: dto.deliveryRadiusKm ?? 10,
            avgDeliveryTimeMinutes: dto.avgDeliveryTimeMinutes ?? 40,
            logoUrl: dto.logoUrl,
            // Cadastros novos sempre são comerciais. Apenas registros
            // históricos marcados explicitamente como teste seguem ocultos.
            isTestOnly: false,
            settings: { create: {} },
          },
          include: { settings: true },
        });
        if (cnpj) {
          await tx.identityDocument.create({
            data: { value: cnpj, ownerType: "COMPANY", ownerId: company.id },
          });
        }
        return company;
      });
      this.postalCodeLocations.warm(company.zipCode, { city: company.city, state: company.state });
      return company;
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException("Este CNPJ ou identificador da empresa já está em uso.");
      }
      throw error;
    }
  }

  async listAll(query: PaginationQueryDto) {
    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { city: { contains: query.search } },
            { slug: { contains: query.search } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.db().company.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { orders: true, users: true } } },
      }),
      this.db().company.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string) {
    const company = await this.db().company.findUnique({ where: { id }, include: { settings: true } });
    if (!company) throw new NotFoundException("Empresa não encontrada.");
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    const current = await this.findById(id);
    const locationChanged = ["addressLine", "city", "state", "zipCode"]
      .some((field) => dto[field as keyof UpdateCompanyDto] !== undefined && dto[field as keyof UpdateCompanyDto] !== current[field as keyof typeof current]);
    const zipCode = normalizePostalCode(dto.zipCode ?? current.zipCode);
    if (!zipCode) {
      throw new BadRequestException("Informe o CEP operacional da empresa antes de salvar.");
    }
    const cnpj = dto.cnpj === undefined ? current.cnpj : dto.cnpj ? normalizeBrazilDocument(dto.cnpj) : null;
    if (current.cnpj && (locationChanged || cnpj !== current.cnpj)) {
      const shared = await this.db().company.findFirst({
        where: { cnpj: current.cnpj, id: { not: id } },
        select: { id: true, zipCode: true, addressLine: true, city: true, state: true },
      });
      if (shared) {
        const registration = await this.db().identityDocument.findUnique({ where: { value: current.cnpj } });
        if (cnpj !== current.cnpj && registration?.ownerId === id) {
          throw new BadRequestException("Este CNPJ ainda é usado por outra operação. Separe a inscrição dessas unidades antes de alterá-lo.");
        }
        if (cnpj === current.cnpj && (
          shared.zipCode !== zipCode
          || normalizeAddress(shared.addressLine) !== normalizeAddress(dto.addressLine ?? current.addressLine)
          || normalizeAddress(shared.city) !== normalizeAddress(dto.city ?? current.city)
          || shared.state?.toUpperCase() !== (dto.state ?? current.state)?.toUpperCase()
        )) {
          throw new BadRequestException("Operações com o mesmo CNPJ devem continuar no mesmo endereço físico. Informe outro CNPJ antes de mudar o local.");
        }
      }
    }
    if (cnpj && cnpj !== current.cnpj) {
      const [company, user] = await Promise.all([
        this.db().company.findFirst({ where: { cnpj, id: { not: id } } }),
        this.db().user.findUnique({ where: { document: cnpj } }),
      ]);
      if (company || user) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
    }
    try {
      const company = await this.db().$transaction(async (tx: any) => {
        if (current.cnpj !== cnpj) {
          if (current.cnpj) {
            await tx.identityDocument.deleteMany({
              where: { value: current.cnpj, ownerType: "COMPANY", ownerId: id },
            });
          }
          if (cnpj) {
            await tx.identityDocument.create({
              data: { value: cnpj, ownerType: "COMPANY", ownerId: id },
            });
          }
        }
        return tx.company.update({
          where: { id },
          data: {
            ...dto,
            zipCode,
            cnpj,
            slug: dto.slug ? slugify(dto.slug) : undefined,
            ...confirmedLocationPatch(dto, locationChanged),
          },
          // A tela de Configurações mantém esta resposta no cache. Devolver
          // também as configurações evita que salvar endereço/taxas apague do
          // cache local os horários, pagamentos ou preferências de IA.
          include: { settings: true },
        });
      });
      this.postalCodeLocations.warm(company.zipCode, { city: company.city, state: company.state });
      return company;
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException("Este CNPJ ou slug já está vinculado a outra conta.");
      }
      throw error;
    }
  }

  /**
   * Ativa ou desativa a empresa.
   *
   * Desativar encerra a assinatura no provedor antes de mexer no cadastro. A
   * ordem importa: marcar a empresa como inativa e falhar no cancelamento
   * deixaria o lojista sem acesso e ainda pagando — o pior dos dois lados. Por
   * isso, se o provedor recusar, a desativação não acontece e o erro sobe.
   *
   * Não é reversível pelo botão: reativar a empresa devolve o acesso, mas a
   * assinatura precisa ser contratada de novo.
   */
  async setActive(id: string, isActive: boolean) {
    await this.findById(id);

    if (!isActive && this.billing) {
      try {
        await this.billing.cancelCompanySubscription(id, { imediato: true });
      } catch (error) {
        // Empresa sem assinatura é caso normal: nasceu, nunca contratou, e está
        // sendo desativada. Só o que impede o cancelamento de verdade é que
        // deve barrar a desativação.
        const semAssinatura = error instanceof NotFoundException
          || (error instanceof BadRequestException && /não possui uma assinatura/.test(error.message));
        if (!semAssinatura) throw error;
      }
    }

    const empresa = await this.db().company.update({ where: { id }, data: { isActive } });
    this.logger.log(
      isActive
        ? `Empresa ${id} reativada. A assinatura precisa ser contratada de novo.`
        : `Empresa ${id} desativada e assinatura encerrada no provedor.`,
    );
    return empresa;
  }

  async createAdmin(companyId: string, dto: CreateCompanyAdminDto) {
    await this.findById(companyId);
    const email = dto.email.trim().toLowerCase();
    if (isReservedDemoEmail(email)) {
      throw new BadRequestException("Este e-mail é reservado à operação interna de demonstração.");
    }
    const existing = await this.db().user.findUnique({ where: { email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    const user = await this.db().user.create({
      data: {
        name: dto.name,
        email,
        passwordHash: await bcrypt.hash(dto.password, 12),
        role: Role.ADMIN,
        companyId,
        employeeProfile: { create: { companyId, position: "Administrador" } },
      },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    await this.auth.sendVerificationForUser(user.id);
    return user;
  }

  async getMyCompany(companyId: string) {
    return this.findById(companyId);
  }

  async updateMyCompany(companyId: string, dto: UpdateCompanyDto) {
    const { slug: _slug, ...rest } = dto;
    return this.update(companyId, rest);
  }

  async uploadLogo(companyId: string, file: any) {
    const current = await this.findById(companyId);
    if (!file) throw new BadRequestException("Envie uma imagem para a loja.");
    const logoUrl = await this.storage.savePublicImage(file, "companies", companyId);

    try {
      const company = await this.db().company.update({
        where: { id: companyId },
        data: { logoUrl },
        include: { settings: true },
      });
      await this.storage.removePublicUrl(current.logoUrl);
      return company;
    } catch (error) {
      await this.storage.removePublicUrl(logoUrl);
      throw error;
    }
  }

  async updateSettings(companyId: string, dto: UpdateCompanySettingsDto) {
    let data = dto;
    if (dto.openingHours) {
      const valid = /^(?:Fechado|(?:[01]\d|2[0-3]):[0-5]\d\s*-\s*(?:[01]\d|2[0-3]):[0-5]\d)$/i;
      const hours = Object.entries(dto.openingHours as Record<string, unknown>);
      const malformed = hours.find(
        ([, value]) => typeof value !== "string" || (value.trim() && !valid.test(value.trim())),
      );
      if (malformed) {
        throw new BadRequestException(
          `Horário inválido em ${malformed[0]}. Use 08:00-18:00 ou Fechado.`,
        );
      }
      const openingHours = Object.fromEntries(
        hours.flatMap(([day, value]) => (
          typeof value === "string" && value.trim()
            ? [[day, value.trim().replace(/\s+/g, "")]]
            : []
        )),
      );
      data = { ...dto, openingHours };
    }
    return this.db().companySettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
  }

  /**
   * Diretório público: CEP reduz as candidatas por proximidade média; a rota
   * completa no checkout é a confirmação definitiva da entrega.
   */
  async publicList(params: { city?: string; state?: string; neighborhood?: string; search?: string; zipCode?: string }, viewer?: JwtPayload) {
    const catalogScope = this.legacyTestData
      ? await this.legacyTestData.publicCatalogCompanyScope(viewer, params.city)
      : { isTestOnly: false, ...filtroPublicoDeEmpresa({ cidade: params.city }) };
    const where: any = {
      isActive: true,
      isPublished: true,
      ...catalogScope,
    };
    if (params.search) where.name = { contains: params.search };

    const companies = await this.db().company.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        state: true,
        zipCode: true,
        logoUrl: true,
        deliveryFeeBase: true,
        deliveryFeePerKm: true,
        deliveryRadiusKm: true,
        avgDeliveryTimeMinutes: true,
      },
      orderBy: { name: "asc" },
    });
    const eligibleIds = params.zipCode
      ? new Set(await this.postalCodeLocations.filterCompaniesForCustomerPostalCode(
        params.zipCode,
        { city: params.city, state: params.state },
        companies,
      ))
      : null;
    return companies
      .filter((company: any) => !eligibleIds || eligibleIds.has(company.id))
      .map(({ zipCode: _zipCode, ...company }: any) => company);
  }

  /**
   * Vitrine pública da loja. O `select` é explícito de propósito: espalhar o
   * registro inteiro expunha CNPJ, telefone, coordenadas, `isActive` e datas
   * internas numa rota anônima, bastando enumerar os slugs devolvidos por
   * `publicList`. Só entra aqui o que a loja realmente mostra ao cliente.
   */
  async publicFindBySlug(slug: string, viewer?: JwtPayload) {
    const catalogScope = this.legacyTestData
      ? await this.legacyTestData.publicCatalogCompanyScope(viewer)
      : { isTestOnly: false, ...filtroPublicoDeEmpresa() };
    const company = await this.db().company.findFirst({
      where: {
        slug,
        isActive: true,
        isPublished: true,
        ...catalogScope,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        addressLine: true,
        city: true,
        state: true,
        logoUrl: true,
        deliveryFeeBase: true,
        deliveryFeePerKm: true,
        deliveryRadiusKm: true,
        avgDeliveryTimeMinutes: true,
        deliveryAreas: {
          where: { isActive: true },
          select: { id: true, neighborhood: true, city: true, deliveryFee: true },
        },
        settings: { select: { openingHours: true, paymentMethodsEnabled: true, pickupEnabled: true } },
      },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    return { ...company, isOpen: isStoreOpen(company.settings?.openingHours) };
  }
}

function isUniqueConstraint(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "P2002";
}

function normalizeAddress(value?: string | null) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
