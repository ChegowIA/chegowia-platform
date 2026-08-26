import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { PaginationQueryDto, paginate } from "../common/dto/pagination-query.dto";
import {
  CreateProductDto,
  ProductAddonDto,
  ProductOptionGroupDto,
  ProductVariationDto,
  UpdateProductDto,
} from "./dto/product.dto";
import { LocalStorageService } from "../common/storage/local-storage.service";

const PRODUCT_INCLUDE = {
  category: true,
  variations: true,
  addons: true,
  optionGroups: {
    orderBy: { position: "asc" as const },
    include: { options: { orderBy: { position: "asc" as const } } },
  },
};

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
        include: PRODUCT_INCLUDE,
      }),
      this.db().product.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
  }

  async findById(id: string) {
    const product = await this.db().product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) throw new NotFoundException("Produto não encontrado.");
    return product;
  }

  async create(dto: CreateProductDto) {
    const { variations, addons, optionGroups, ...data } = dto;
    const groups = this.prepareOptionGroups(optionGroups);
    return this.db().product.create({
      data: {
        ...data,
        variations: variations?.length ? { create: variations } : undefined,
        addons: addons?.length ? { create: addons } : undefined,
        optionGroups: groups?.length ? { create: groups } : undefined,
      },
      include: PRODUCT_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findById(id);
    const { optionGroups, ...data } = dto;
    // A tela envia a composição completa dos grupos. Trocar tudo em uma única
    // transação elimina opções que foram removidas no editor e evita sobrar um
    // sabor/tamanho antigo disponível para o próximo pedido.
    if (optionGroups === undefined) {
      return this.db().product.update({ where: { id }, data, include: PRODUCT_INCLUDE });
    }
    const groups = this.prepareOptionGroups(optionGroups);
    return this.db().$transaction(async (tx: any) => {
      await tx.productOptionGroup.deleteMany({ where: { productId: id } });
      return tx.product.update({
        where: { id },
        data: {
          ...data,
          optionGroups: groups?.length ? { create: groups } : undefined,
        },
        include: PRODUCT_INCLUDE,
      });
    });
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
        include: PRODUCT_INCLUDE,
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

  /**
   * Normaliza e protege a configuração antes de chegar ao Prisma. O banco
   * guarda o grupo genérico; estas regras garantem que um grupo obrigatório
   * sempre possa ser atendido e que uma opção única não aceite dois itens.
   */
  private prepareOptionGroups(groups?: ProductOptionGroupDto[]) {
    if (groups === undefined) return undefined;
    const names = new Set<string>();

    return groups.map((group, index) => {
      const name = group.name.trim();
      if (!name) throw new BadRequestException("Todo grupo de escolhas precisa de um nome.");
      const normalizedName = name.toLocaleLowerCase("pt-BR");
      if (names.has(normalizedName)) {
        throw new BadRequestException(`O grupo "${name}" foi informado mais de uma vez.`);
      }
      names.add(normalizedName);

      const minSelections = Number(group.minSelections);
      const maxSelections = Number(group.maxSelections);
      if (
        !Number.isInteger(minSelections)
        || !Number.isInteger(maxSelections)
        || minSelections < 0
        || maxSelections < 1
        || maxSelections > 30
        || minSelections > maxSelections
      ) {
        throw new BadRequestException(`Revise o mínimo e o máximo de escolhas em "${name}".`);
      }
      if (group.selectionType === "SINGLE" && maxSelections !== 1) {
        throw new BadRequestException(`O grupo "${name}" aceita uma única opção; o máximo deve ser 1.`);
      }
      if (group.options.length < maxSelections) {
        throw new BadRequestException(`Adicione ao menos ${maxSelections} opção(ões) ao grupo "${name}".`);
      }

      const optionNames = new Set<string>();
      const options = group.options.map((option, optionIndex) => {
        const optionName = option.name.trim();
        if (!optionName) throw new BadRequestException(`Informe o nome de cada opção em "${name}".`);
        const normalizedOptionName = optionName.toLocaleLowerCase("pt-BR");
        if (optionNames.has(normalizedOptionName)) {
          throw new BadRequestException(`A opção "${optionName}" foi repetida em "${name}".`);
        }
        optionNames.add(normalizedOptionName);
        const priceDelta = Number(option.priceDelta);
        if (!Number.isFinite(priceDelta)) {
          throw new BadRequestException(`Informe um preço válido para "${optionName}".`);
        }
        return {
          name: optionName,
          priceDelta,
          position: optionIndex,
        };
      });

      return {
        name,
        description: group.description?.trim() || null,
        selectionType: group.selectionType,
        minSelections,
        maxSelections,
        pricingRule: group.pricingRule,
        position: index,
        options: { create: options },
      };
    });
  }
}
