import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { CreateAddressDto, UpdateAddressDto } from "./dto/address.dto";

@Injectable()
export class AddressesService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  private db() {
    return this.prisma as any;
  }

  list(userId: string) {
    return this.db().address.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  async create(userId: string, dto: CreateAddressDto) {
    if (dto.isDefault) await this.clearDefault(userId);
    return this.db().address.create({ data: { ...dto, userId } });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    await this.ensureOwnership(userId, id);
    if (dto.isDefault) await this.clearDefault(userId);
    return this.db().address.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    return this.db().address.delete({ where: { id } });
  }

  private async clearDefault(userId: string) {
    await this.db().address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  }

  private async ensureOwnership(userId: string, id: string) {
    const address = await this.db().address.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException("Endereço não encontrado.");
    return address;
  }
}
