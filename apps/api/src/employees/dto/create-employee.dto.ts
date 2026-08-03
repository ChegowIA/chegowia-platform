import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Role } from "@prisma/client";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export const INTERNAL_ROLES = [Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY, Role.GARCOM] as const;

export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  @MatchesProperty("password")
  confirmPassword: string;

  @IsIn(INTERNAL_ROLES)
  role: (typeof INTERNAL_ROLES)[number];

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];
}
