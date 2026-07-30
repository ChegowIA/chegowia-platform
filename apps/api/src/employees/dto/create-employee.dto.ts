import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { Role } from "@prisma/client";

export const INTERNAL_ROLES = [Role.FUNCIONARIO, Role.COZINHA, Role.MOTOBOY] as const;

export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

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
