import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
