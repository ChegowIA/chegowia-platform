import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import {
  PlatformSupportConversationMode,
  PlatformSupportConversationStatus,
} from "@prisma/client";

export class ListPlatformSupportConversationsDto {
  @IsOptional()
  @IsEnum(PlatformSupportConversationMode)
  mode?: PlatformSupportConversationMode;

  @IsOptional()
  @IsEnum(PlatformSupportConversationStatus)
  status?: PlatformSupportConversationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
