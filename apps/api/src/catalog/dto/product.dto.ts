import { PartialType, OmitType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { TaxOrigin } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const onlyDigits = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.replace(/\D/g, "") : value;

export class ProductVariationDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  priceDelta: number;
}

export class ProductAddonDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  @Min(0)
  price: number;
}

export class CreateProductDto {
  @IsString()
  categoryId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  /**
   * Custo de compra/produção. Opcional: sem ele o fechamento de caixa mostra
   * faturamento e não chama nada de lucro.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariationDto)
  variations?: ProductVariationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAddonDto)
  addons?: ProductAddonDto[];

  // ---- Tributação do item ----
  // Tudo opcional: em branco significa "usa o padrão da empresa"
  // (CompanyFiscalProfile.default*). Ver fiscal/product-tax.ts. Obrigar o
  // preenchimento aqui quebraria o cadastro de produto de quem ainda nem
  // preencheu o fiscal, e o cardápio precisa continuar utilizável antes disso.

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{8}$/, { message: "O NCM deve ter 8 dígitos." })
  ncm?: string;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{7}$/, { message: "O CEST deve ter 7 dígitos." })
  cest?: string;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{4}$/, { message: "O CFOP deve ter 4 dígitos." })
  cfop?: string;

  @IsOptional()
  @IsEnum(TaxOrigin)
  taxOrigin?: TaxOrigin;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2,3}$/, { message: "O código de ICMS deve ter 2 ou 3 dígitos." })
  icmsCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  icmsRate?: number;

  /** Redução da base de cálculo; obrigatória quando o CST de ICMS é 20. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  icmsReductionRate?: number;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2}$/, { message: "O CST de PIS deve ter 2 dígitos." })
  pisCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pisRate?: number;

  @IsOptional()
  @Transform(onlyDigits)
  @IsString()
  @Matches(/^\d{2}$/, { message: "O CST de COFINS deve ter 2 dígitos." })
  cofinsCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cofinsRate?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(6)
  unit?: string;
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ["variations", "addons"] as const),
) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
