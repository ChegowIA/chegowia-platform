import { IsEnum, IsOptional } from "class-validator";
import { WhatsAppConversationMode, WhatsAppConversationStatus } from "@prisma/client";

export class UpdatePlatformWhatsAppConversationDto {
  @IsOptional()
  @IsEnum(WhatsAppConversationMode)
  mode?: WhatsAppConversationMode;

  @IsOptional()
  @IsEnum(WhatsAppConversationStatus)
  status?: WhatsAppConversationStatus;
}
