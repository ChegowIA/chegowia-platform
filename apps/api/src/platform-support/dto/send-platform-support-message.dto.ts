import { IsString, MaxLength, MinLength } from "class-validator";

/** Texto enviado por uma pessoa ao suporte autenticado da ChegowIA. */
export class SendPlatformSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
