import { IsEnum, IsOptional } from "class-validator";
import {
  PlatformSupportConversationMode,
  PlatformSupportConversationStatus,
} from "@prisma/client";

/** Comandos da equipe da ChegowIA para uma conversa de suporte. */
export class UpdatePlatformSupportConversationDto {
  @IsOptional()
  @IsEnum(PlatformSupportConversationMode)
  mode?: PlatformSupportConversationMode;

  @IsOptional()
  @IsEnum(PlatformSupportConversationStatus)
  status?: PlatformSupportConversationStatus;
}
