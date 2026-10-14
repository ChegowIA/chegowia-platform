import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { IsCnpj, normalizeBrazilDocument } from "../../common/validators/brazil-document.validator";

const digits = ({ value }: { value: unknown }) => String(value ?? "").replace(/\D/g, "");
const trim = ({ value }: { value: unknown }) => String(value ?? "").trim();

/** Dados mínimos da nova operação; o plano vem da unidade atual. */
export class CreateUnitDto {
  @Transform(trim) @IsString() @MinLength(2) name: string;
  @Transform(({ value }) => normalizeBrazilDocument(value) || undefined) @IsOptional() @IsString() @IsCnpj() cnpj?: string;
  @IsOptional() @IsBoolean() shareCnpj?: boolean;
  @Transform(trim) @IsString() @MinLength(8) phone: string;
  @Transform(trim) @IsString() @MinLength(2) addressLine: string;
  @Transform(trim) @IsString() @MinLength(2) city: string;
  @Transform(({ value }) => String(value ?? "").trim().toUpperCase())
  @IsString() @Matches(/^[A-Z]{2}$/, { message: "Informe a UF com duas letras." }) state: string;
  @Transform(digits) @IsString() @Matches(/^\d{8}$/, { message: "Informe o CEP com 8 dígitos." }) zipCode: string;
  @Transform(trim) @IsString() @MinLength(2) adminName: string;
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsEmail() adminEmail: string;
}
