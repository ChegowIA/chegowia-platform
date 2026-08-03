import { Transform } from "class-transformer";
import { Equals, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { IsBrazilDocument } from "../../common/validators/brazil-document.validator";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export class ResellerApplicationDto {
  @IsString() @MinLength(3) fullName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) phone: string;
  @IsString() @IsBrazilDocument() document: string;
  @IsString() city: string;
  @IsString() @MaxLength(2) state: string;
  @IsOptional() @IsString() linkedinUrl?: string;
  @IsString() @MinLength(80) resumeText: string;
  @IsString() @MinLength(120) motivation: string;
  @IsString() @MinLength(120) commitment: string;
  @IsOptional() @IsString() experience?: string;
  @IsString() @IsStrongPassword() password: string;
  @IsString() @MatchesProperty("password") confirmPassword: string;
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean() @Equals(true, { message: "É necessário aceitar os Termos do Programa." })
  acceptTerms: boolean;
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean() @Equals(true, { message: "É necessário aceitar a Política de Privacidade." })
  acceptPrivacy: boolean;
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean() @Equals(true, { message: "É necessário autorizar a análise automatizada da candidatura." })
  acceptAutomatedAnalysis: boolean;
}
