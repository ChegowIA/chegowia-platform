import { IsString, MinLength } from "class-validator";

export class DeleteAccountDto {
  /**
   * A exclusão é irreversível; exigir a senha impede que uma sessão sequestrada
   * apague a conta da vítima.
   */
  @IsString()
  @MinLength(1)
  password: string;
}
