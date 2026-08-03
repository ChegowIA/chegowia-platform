import { IsString, MaxLength, MinLength } from "class-validator";

export class SendWhatsAppMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content: string;
}
