import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name: string;

  @IsInt()
  @Min(1)
  @Max(30)
  seats: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  area?: string;
}
