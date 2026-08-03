import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import { DeliveryProblemReason, DeliveryStatus } from "@prisma/client";

export class UpdateDeliveryStatusDto {
  @IsEnum(DeliveryStatus)
  status: DeliveryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ValidateIf((dto: UpdateDeliveryStatusDto) => dto.status === DeliveryStatus.PROBLEMA)
  @IsEnum(DeliveryProblemReason, { message: "Selecione um motivo válido para o problema." })
  problemReason?: DeliveryProblemReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  problemDescription?: string;
}
