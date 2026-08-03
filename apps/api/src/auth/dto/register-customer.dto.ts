import { Equals, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export class RegisterCustomerDto {
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

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(2)
  street: string;

  @IsString()
  number: string;

  @IsString()
  neighborhood: string;

  @IsString()
  @MinLength(2)
  city: string;

  @IsString()
  @MinLength(2)
  state: string;

  @IsOptional()
  @IsString()
  zipCode?: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsBoolean()
  @Equals(true, { message: "Você precisa aceitar os Termos de Uso." })
  acceptTerms: boolean;

  @IsBoolean()
  @Equals(true, { message: "Você precisa aceitar a Política de Privacidade." })
  acceptPrivacy: boolean;
}
