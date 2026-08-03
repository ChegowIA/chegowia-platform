import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import { CreateProductDto, ProductAddonDto, ProductVariationDto, UpdateProductDto } from "./dto/product.dto";
import { LocalStorageService } from "../common/storage/local-storage.service";

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly storage: LocalStorageService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  async list(query: PaginationQueryDto & { categoryId?: string }) {
    const where: any = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) where.name = { contains: query.search };

    const [items, total] = await Promise.all([
      this.db().product.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: { category: true, variations: true, addons: true },
      }),
      this.db().product.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string) {
    const product = await this.db().product.findUnique({
      where: { id },
      include: { category: true, variations: true, addons: true },
    });
    if (!product) throw new NotFoundException("Produto não encontrado.");
    return product;
  }

  async create(dto: CreateProductDto) {
    const { variations, addons, ...data } = dto;
    return this.db().product.create({
      data: {
        ...data,
        variations: variations?.length ? { create: variations } : undefined,
        addons: addons?.length ? { create: addons } : undefined,
      },
      include: { variations: true, addons: true },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findById(id);
    return this.db().product.update({ where: { id }, data: dto });
  }

  async uploadImage(id: string, file: any) {
    const current = await this.findById(id);
    if (!file) throw new BadRequestException("Envie uma imagem para o produto.");
    const imageUrl = await this.storage.savePublicImage(file, "products", id);

    let product: any;
    try {
      product = await this.db().product.update({
        where: { id },
        data: { imageUrl },
        include: { category: true, variations: true, addons: true },
      });
    } catch (error) {
      await this.storage.removePublicUrl(imageUrl);
      throw error;
    }
    await this.storage.removePublicUrl(current.imageUrl);
    return product;
  }

  async remove(id: string) {
    await this.findById(id);
    return this.db().product.update({ where: { id }, data: { isActive: false } });
  }

  async addVariation(productId: string, dto: ProductVariationDto) {
    await this.findById(productId);
    return this.db().productVariation.create({ data: { ...dto, productId } });
  }

  async removeVariation(productId: string, variationId: string) {
    await this.findById(productId);
    const variation = await this.db().productVariation.findFirst({ where: { id: variationId, productId } });
    if (!variation) throw new NotFoundException("Variação não encontrada.");
    return this.db().productVariation.delete({ where: { id: variationId } });
  }

  async addAddon(productId: string, dto: ProductAddonDto) {
    await this.findById(productId);
    return this.db().productAddon.create({ data: { ...dto, productId } });
  }

  async removeAddon(productId: string, addonId: string) {
    await this.findById(productId);
    const addon = await this.db().productAddon.findFirst({ where: { id: addonId, productId } });
    if (!addon) throw new NotFoundException("Adicional não encontrado.");
    return this.db().productAddon.delete({ where: { id: addonId } });
  }
}
