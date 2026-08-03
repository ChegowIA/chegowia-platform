import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateProspectDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() notes?: string;
}
