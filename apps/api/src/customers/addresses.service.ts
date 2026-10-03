import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { CreateAddressDto, UpdateAddressDto } from "./dto/address.dto";
import { normalizePostalCode, PostalCodeLocationService } from "../common/geography/postal-code-location.service";

@Injectable()
export class AddressesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly postalCodeLocations: PostalCodeLocationService,
  ) {}

  private db() {
    return this.prisma as any;
  }

  list(userId: string) {
    return this.db().address.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  }

  async create(userId: string, dto: CreateAddressDto) {
    const zipCode = normalizePostalCode(dto.zipCode);
    if (!zipCode) {
      throw new BadRequestException("Informe um CEP válido de 8 dígitos antes de salvar o endereço.");
    }
    if (dto.isDefault) await this.clearDefault(userId);
    const address = await this.db().address.create({ data: { ...dto, zipCode, userId } });
    this.postalCodeLocations.warm(address.zipCode, { city: address.city, state: address.state });
    return address;
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    const current = await this.ensureOwnership(userId, id);
    const zipCode = normalizePostalCode(dto.zipCode ?? current.zipCode);
    if (!zipCode) {
      throw new BadRequestException("Informe um CEP válido de 8 dígitos antes de salvar o endereço.");
    }
    if (dto.isDefault) await this.clearDefault(userId);
    const locationChanged = ["street", "number", "complement", "neighborhood", "city", "state", "zipCode"]
      .some((field) => dto[field as keyof UpdateAddressDto] !== undefined && dto[field as keyof UpdateAddressDto] !== current[field as keyof typeof current]);
    const address = await this.db().address.update({
      where: { id },
      data: {
        ...dto,
        zipCode,
        ...(locationChanged ? { latitude: null, longitude: null } : {}),
      },
    });
    this.postalCodeLocations.warm(address.zipCode, { city: address.city, state: address.state });
    return address;
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
