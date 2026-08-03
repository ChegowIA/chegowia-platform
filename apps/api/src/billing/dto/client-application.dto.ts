import { Equals, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { IsCnpj } from "../../common/validators/brazil-document.validator";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export class ClientApplicationDto {
  @IsOptional() @IsString() sourceLeadId?: string;
  @IsString() planId: string;
  @IsOptional() @IsString() resellerCode?: string;
  @IsString() @MinLength(3) responsibleName: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) phone: string;
  @IsString() @IsCnpj() document: string;
  @IsString() @MinLength(2) companyName: string;
  @IsOptional() @IsString() tradeName?: string;
  @IsString() city: string;
  @IsString() state: string;
  @IsString() businessType: string;
  @IsString() @MinLength(80) operationDetails: string;
  @IsString() @IsStrongPassword() password: string;
  @IsString() @MatchesProperty("password") confirmPassword: string;
  @IsBoolean() @Equals(true, { message: "É necessário aceitar os Termos de Uso." }) acceptTerms: boolean;
  @IsBoolean() @Equals(true, { message: "É necessário aceitar a Política de Privacidade." }) acceptPrivacy: boolean;
  @IsBoolean() @Equals(true, { message: "É necessário autorizar a análise automatizada do cadastro." }) acceptAutomatedAnalysis: boolean;
}
