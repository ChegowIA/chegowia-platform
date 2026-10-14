import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min, ValidateIf } from "class-validator";
import { PaymentMethod } from "@prisma/client";

const onlyDocumentCharacters = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : value;

export class EmitDocumentDto {
  /** Um dos dois é obrigatório: nota de delivery ou de comanda de mesa. */
  @ValidateIf((dto: EmitDocumentDto) => !dto.tableSessionId)
  @IsString()
  orderId?: string;

  @ValidateIf((dto: EmitDocumentDto) => !dto.orderId)
  @IsString()
  tableSessionId?: string;

  /** CPF ou CNPJ na nota. Ausente = consumidor não identificado. */
  @IsOptional()
  @Transform(onlyDocumentCharacters)
  @IsString()
  @Matches(/^(\d{11}|[A-Z0-9]{12}\d{2})$/, { message: "Informe um CPF ou CNPJ válido." })
  customerDocument?: string;

  /** Só é necessário para comandas antigas que foram fechadas sem recebimento registrado. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class CancelDocumentDto {
  /**
   * A SEFAZ exige 15 caracteres na justificativa. Validar aqui evita a
   * rejeição 229 e explica o motivo antes do envio.
   */
  @IsString()
  @Length(15, 255)
  reason: string;
}

export class CorrectDocumentDto {
  @IsString()
  @Length(15, 1000)
  correction: string;
}

export class InutilizeRangeDto {
  @IsInt()
  @Min(1)
  start: number;

  @IsInt()
  @Min(1)
  end: number;

  @IsString()
  @Length(15, 255)
  reason: string;
}
