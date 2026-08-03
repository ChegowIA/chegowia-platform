import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateLeadDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() companyName?: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) phone: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsString() @MinLength(20) message: string;
}
