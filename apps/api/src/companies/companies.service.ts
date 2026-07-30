import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class CompaniesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

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
    return this.db().company.create({
      data: {
        name: dto.name,
        slug,
        cnpj: dto.cnpj,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        deliveryFeeBase: dto.deliveryFeeBase ?? 0,
        avgDeliveryTimeMinutes: dto.avgDeliveryTimeMinutes ?? 40,
        logoUrl: dto.logoUrl,
        settings: { create: {} },
      },
      include: { settings: true },
    });
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
    await this.findById(id);
    return this.db().company.update({
      where: { id },
      data: {
        ...dto,
        slug: dto.slug ? slugify(dto.slug) : undefined,
      },
    });
  }

  async setActive(id: string, isActive: boolean) {
    await this.findById(id);
    return this.db().company.update({ where: { id }, data: { isActive } });
  }

  async createAdmin(companyId: string, dto: CreateCompanyAdminDto) {
    await this.findById(companyId);
    const existing = await this.db().user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Já existe uma conta com este e-mail.");

    return this.db().user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: Role.ADMIN,
        companyId,
        employeeProfile: { create: { companyId, position: "Administrador" } },
      },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
  }

  async getMyCompany(companyId: string) {
    return this.findById(companyId);
  }

  async updateMyCompany(companyId: string, dto: UpdateCompanyDto) {
    const { slug: _slug, ...rest } = dto;
    return this.db().company.update({ where: { id: companyId }, data: rest });
  }

  async updateSettings(companyId: string, dto: UpdateCompanySettingsDto) {
    return this.db().companySettings.upsert({
      where: { companyId },
      create: { companyId, ...dto },
      update: dto,
    });
  }

  /** Diretório público — só empresas ativas, com filtros de cidade/bairro/busca por nome. */
  async publicList(params: { city?: string; neighborhood?: string; search?: string }) {
    const where: any = { isActive: true };
    if (params.city) where.city = { contains: params.city };
    if (params.search) where.name = { contains: params.search };
    if (params.neighborhood) {
      where.deliveryAreas = { some: { neighborhood: { contains: params.neighborhood }, isActive: true } };
    }

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
        avgDeliveryTimeMinutes: true,
        deliveryAreas: { where: { isActive: true }, select: { neighborhood: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async publicFindBySlug(slug: string) {
    const company = await this.db().company.findFirst({
      where: { slug, isActive: true },
      include: {
        deliveryAreas: { where: { isActive: true } },
        settings: { select: { openingHours: true, paymentMethodsEnabled: true, whatsappNumber: true } },
      },
    });
    if (!company) throw new NotFoundException("Loja não encontrada.");
    return company;
  }
}
