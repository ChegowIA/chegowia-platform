import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { TaxOrigin } from "@prisma/client";

export enum CatalogImportDuplicateStrategy {
  SKIP = "SKIP",
  CREATE = "CREATE",
}

export class CatalogImportVariationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsNumber()
  @Min(-999999)
  @Max(999999)
  priceDelta: number;
}

export class CatalogImportAddonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;
}

/** Um item revisado no navegador. `rowKey` sempre é conferido contra a sessão. */
export class CatalogImportProductDto {
  @IsString()
  @MaxLength(80)
  rowKey: string;

  @IsBoolean()
  include: boolean;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  category: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  @IsNumber()
  @Min(0)
  @Max(999999)
  price: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999)
  costPrice?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CatalogImportVariationDto)
  variations?: CatalogImportVariationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CatalogImportAddonDto)
  addons?: CatalogImportAddonDto[];

  @IsOptional()
  @IsString()
  @MaxLength(6)
  unit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  ncm?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  cest?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  cfop?: string | null;

  @IsOptional()
  @IsEnum(TaxOrigin)
  taxOrigin?: TaxOrigin | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  icmsCode?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  icmsRate?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  pisCode?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pisRate?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  cofinsCode?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  cofinsRate?: number | null;
}

export class ApplyCatalogImportDto {
  @IsArray()
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => CatalogImportProductDto)
  items: CatalogImportProductDto[];

  @IsOptional()
  @IsEnum(CatalogImportDuplicateStrategy)
  duplicateStrategy?: CatalogImportDuplicateStrategy;
}
