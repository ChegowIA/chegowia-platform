import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { PRISMA_CLIENT } from "../common/prisma/prisma.constants";
import { ExtendedPrismaClient } from "../common/prisma/prisma-client.factory";
import { CreateAddressDto, PreviewAddressLocationDto, UpdateAddressDto } from "./dto/address.dto";
import { normalizePostalCode, PostalCodeLocationService } from "../common/geography/postal-code-location.service";
import { GeographyService } from "../common/geography/geography.service";
import { confirmedLocationPatch } from "../common/geography/confirmed-location";

@Injectable()
export class AddressesService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly postalCodeLocations: PostalCodeLocationService,
    private readonly geography: GeographyService,
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
    const locationPatch = confirmedLocationPatch(dto, false);
    if (dto.isDefault) await this.clearDefault(userId);
    const address = await this.db().address.create({
      data: { ...dto, zipCode, userId, ...locationPatch },
    });
    this.postalCodeLocations.warm(address.zipCode, { city: address.city, state: address.state });
    return address;
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    const current = await this.ensureOwnership(userId, id);
    const zipCode = normalizePostalCode(dto.zipCode ?? current.zipCode);
    if (!zipCode) {
      throw new BadRequestException("Informe um CEP válido de 8 dígitos antes de salvar o endereço.");
    }
    const locationChanged = ["street", "number", "neighborhood", "city", "state", "zipCode"]
      .some((field) => dto[field as keyof UpdateAddressDto] !== undefined && dto[field as keyof UpdateAddressDto] !== current[field as keyof typeof current]);
    const locationPatch = confirmedLocationPatch(dto, locationChanged);
    if (dto.isDefault) await this.clearDefault(userId);
    const address = await this.db().address.update({
      where: { id },
      data: {
        ...dto,
        zipCode,
        ...locationPatch,
      },
    });
    this.postalCodeLocations.warm(address.zipCode, { city: address.city, state: address.state });
    return address;
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    return this.db().address.delete({ where: { id } });
  }

  async previewLocation(dto: PreviewAddressLocationDto) {
    try {
      const point = await this.geography.geocode(dto);
      return { ...point, approximate: true, source: "address" };
    } catch (error) {
      if (!(error instanceof BadRequestException) && !(error instanceof ServiceUnavailableException)) throw error;
      const point = await this.postalCodeLocations.resolve(dto.zipCode, { city: dto.city, state: dto.state });
      return { ...point, approximate: true, source: "postalCode" };
    }
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
