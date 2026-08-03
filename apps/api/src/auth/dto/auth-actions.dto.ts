import { IsEmail, IsString, Length } from "class-validator";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export class VerifyEmailDto {
  @IsString()
  token: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @IsStrongPassword()
  password: string;

  @IsString()
  @MatchesProperty("password")
  confirmPassword: string;
}

export class VerifyMfaDto {
  @IsString()
  challengeId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
