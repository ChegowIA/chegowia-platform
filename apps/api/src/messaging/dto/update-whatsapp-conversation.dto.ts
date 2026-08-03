import { IsEnum, IsOptional, IsString } from "class-validator";
import { WhatsAppConversationMode, WhatsAppConversationStatus } from "@prisma/client";

export class UpdateWhatsAppConversationDto {
  @IsOptional()
  @IsEnum(WhatsAppConversationMode)
  mode?: WhatsAppConversationMode;

  @IsOptional()
  @IsEnum(WhatsAppConversationStatus)
  status?: WhatsAppConversationStatus;

  @IsOptional()
  @IsString()
  assignedToUserId?: string | null;
}
