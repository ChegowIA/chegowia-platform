import { IsString } from "class-validator";
import { IsStrongPassword } from "../../common/validators/strong-password.validator";
import { MatchesProperty } from "../../common/validators/match-property.validator";

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @IsStrongPassword()
  newPassword: string;

  @IsString()
  @MatchesProperty("newPassword")
  confirmPassword: string;
}
