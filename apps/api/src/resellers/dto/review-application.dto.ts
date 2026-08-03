import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class ReviewApplicationDto {
  @IsBoolean() approve: boolean;
  @IsOptional() @IsString() @MinLength(5) notes?: string;
}
