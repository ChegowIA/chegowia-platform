import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import { FiscalEnvironment, TaxOrigin, TaxRegime } from "@prisma/client";

const onlyDigits = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.replace(/\D/g, "") : value;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

const upper = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toUpperCase() : value;

/**
 * Cadastro fiscal da empresa.
 *
 * As máscaras são removidas na entrada: o XML da NFC-e só aceita dígitos, e
 * aceitar `12.345-6` da tela e gravar assim significaria normalizar na hora da
 * emissão — tarde demais para avisar o lojista que o dado está errado.
 *
 * `nfceNextNumber` não está aqui de propósito: a numeração é controlada pela
 * emissão, e deixar alguém editá-la à mão criaria nota duplicada ou pulo de
 * sequência, os dois rejeitados pela SEFAZ.
 */
export class UpdateFiscalProfileDto {
  @IsEnum(TaxRegime)
  taxRegime: TaxRegime;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{7}$/, { message: "O CNAE deve ter 7 dígitos." })
  cnae: string;

  @Transform(upper)
  @IsString()
  @Length(2, 20)
  @Matches(/^(ISENTO|[0-9.\-/]+)$/, {
    message: 'A inscrição estadual deve conter apenas números ou a palavra ISENTO.',
  })
  stateRegistration: string;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Length(1, 20)
  municipalRegistration?: string;

  @Transform(trimmed)
  @IsString()
  @Length(2, 191)
  legalName: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(2, 191)
  tradeName?: string;

  @Transform(trimmed)
  @IsString()
  @Length(2, 191)
  addressStreet: string;

  @Transform(trimmed)
  @IsString()
  @Length(1, 20)
  addressNumber: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 191)
  addressComplement?: string;

  @Transform(trimmed)
  @IsString()
  @Length(2, 191)
  addressDistrict: string;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{7}$/, { message: "O código IBGE do município deve ter 7 dígitos." })
  cityIbgeCode: string;

  @Transform(trimmed)
  @IsString()
  @Length(2, 191)
  cityName: string;

  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: "Informe a UF com duas letras." })
  state: string;

  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/, { message: "O CEP deve ter 8 dígitos." })
  zipCode: string;

  @IsOptional()
  @IsEnum(FiscalEnvironment)
  environment?: FiscalEnvironment;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  nfceSeries?: number;

  /** Emitir automaticamente ao marcar o pedido como pago. */
  @IsOptional()
  @IsBoolean()
  autoEmit?: boolean;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{6}$/, { message: "O identificador do CSC deve ter 6 dígitos." })
  cscId?: string;

  /** Token do CSC. Só é gravado quando enviado; nunca volta em resposta. */
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(16, 64)
  cscToken?: string;

  // ---- Padrões fiscais do cardápio ----
  // Validados aqui só quanto ao formato; a coerência com o regime (CSOSN vs
  // CST) é conferida no serviço, que conhece o regime sendo salvo.

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/, { message: "O NCM deve ter 8 dígitos." })
  defaultNcm?: string;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{7}$/, { message: "O CEST deve ter 7 dígitos." })
  defaultCest?: string;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{4}$/, { message: "O CFOP deve ter 4 dígitos." })
  defaultCfop?: string;

  @IsOptional()
  @IsEnum(TaxOrigin)
  defaultTaxOrigin?: TaxOrigin;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2,3}$/, { message: "O código de ICMS deve ter 2 ou 3 dígitos." })
  defaultIcmsCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultIcmsRate?: number;

  /** Redução da base de cálculo; obrigatória quando o CST de ICMS é 20. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultIcmsReductionRate?: number;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2}$/, { message: "O CST de PIS deve ter 2 dígitos." })
  defaultPisCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultPisRate?: number;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2}$/, { message: "O CST de COFINS deve ter 2 dígitos." })
  defaultCofinsCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCofinsRate?: number;

  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(1, 6)
  defaultUnit?: string;
}
