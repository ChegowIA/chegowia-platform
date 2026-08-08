import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, Matches } from "class-validator";
import { PaymentMethod } from "@prisma/client";

const onlyDigits = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.replace(/\D/g, "") || undefined : value;

/** Dados registrados no recebimento final da comanda antes de emitir a NFC-e. */
export class CloseTableDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  /** CPF/CNPJ é opcional na NFC-e, mas quando informado precisa ser válido. */
  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^(\d{11}|\d{14})$/, { message: "Informe um CPF ou CNPJ válido." })
  customerDocument?: string;
}
