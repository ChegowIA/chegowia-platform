import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { INTERNAL_ROLES } from "./create-employee.dto";

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsIn(INTERNAL_ROLES)
  role?: (typeof INTERNAL_ROLES)[number];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
