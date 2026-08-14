import { IsString, Length, Matches } from "class-validator";

/** Token de 32 bytes em base64url, sempre transportado no fragmento da URL. */
export class ConsumeCompanyAccessLinkDto {
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "Atalho de suporte inválido." })
  token!: string;
}
