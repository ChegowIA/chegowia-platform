import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { slugify } from "../common/utils/slugify";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { CreateCompanyAdminDto } from "./dto/create-company-admin.dto";
import { UpdateCompanySettingsDto } from "./dto/update-company-settings.dto";
import { normalizeBrazilDocument } from "../common/validators/brazil-document.validator";
import { AuthService } from "../auth/auth.service";
import { isStoreOpen } from "../common/utils/store-hours";
import { LocalStorageService } from "../common/storage/local-storage.service";

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly auth: AuthService,
    private readonly storage: LocalStorageService,
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

  async create(dto: CreateCompanyDto) {
    const slug = dto.slug ? slugify(dto.slug) : await this.uniqueSlug(dto.name);
    const cnpj = dto.cnpj ? normalizeBrazilDocument(dto.cnpj) : null;
    if (cnpj) {
      const [company, user] = await Promise.all([
        this.db().company.findUnique({ where: { cnpj } }),
        this.db().user.findUnique({ where: { document: cnpj } }),
      ]);
      if (company || user) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
    }
    try {
      return await this.db().$transaction(async (tx: any) => {
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
            deliveryFeeBase: dto.deliveryFeeBase ?? 0,
            deliveryFeePerKm: dto.deliveryFeePerKm ?? 1.5,
            deliveryRadiusKm: dto.deliveryRadiusKm ?? 10,
            avgDeliveryTimeMinutes: dto.avgDeliveryTimeMinutes ?? 40,
            logoUrl: dto.logoUrl,
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
    const locationChanged = ["addressLine", "city", "state"]
      .some((field) => dto[field as keyof UpdateCompanyDto] !== undefined && dto[field as keyof UpdateCompanyDto] !== current[field as keyof typeof current]);
    const cnpj = dto.cnpj ? normalizeBrazilDocument(dto.cnpj) : dto.cnpj;
    if (cnpj) {
      const [company, user] = await Promise.all([
        this.db().company.findFirst({ where: { cnpj, id: { not: id } } }),
        this.db().user.findUnique({ where: { document: cnpj } }),
      ]);
      if (company || user) throw new ConflictException("Este CNPJ já está vinculado a uma conta.");
    }
    try {
      return await this.db().$transaction(async (tx: any) => {
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
            cnpj,
            slug: dto.slug ? slugify(dto.slug) : undefined,
            ...(locationChanged ? { latitude: null, longitude: null } : {}),
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictException("Este CNPJ ou slug já está vinculado a outra conta.");
      }
      throw error;
    }
  }

  async setActive(id: string, isActive: boolean) {
    await this.findById(id);
    return this.db().company.update({ where: { id }, data: { isActive } });
  }

  async createAdmin(companyId: string, dto: CreateCompanyAdminDto) {
    await this.findById(companyId);
    const email = dto.email.trim().toLowerCase();
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

  /** Diretório público — a elegibilidade exata é calculada pela rota no checkout. */
  async publicList(params: { city?: string; neighborhood?: string; search?: string }) {
    const where: any = { isActive: true };
    if (params.city) where.city = { contains: params.city };
    if (params.search) where.name = { contains: params.search };

    return this.db().company.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        state: true,
        logoUrl: true,
        deliveryFeeBase: true,
        deliveryFeePerKm: true,
        deliveryRadiusKm: true,
        avgDeliveryTimeMinutes: true,
      },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Vitrine pública da loja. O `select` é explícito de propósito: espalhar o
   * registro inteiro expunha CNPJ, telefone, coordenadas, `isActive` e datas
   * internas numa rota anônima, bastando enumerar os slugs devolvidos por
   * `publicList`. Só entra aqui o que a loja realmente mostra ao cliente.
   */
  async publicFindBySlug(slug: string) {
    const company = await this.db().company.findFirst({
      where: { slug, isActive: true },
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
          select: { id: true, neighborhood: true, city: true, state: true, deliveryFee: true },
        },
        settings: { select: { openingHours: true, paymentMethodsEnabled: true } },
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
