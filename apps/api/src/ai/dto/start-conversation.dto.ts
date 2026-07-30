import { IsEnum, IsOptional, IsString } from "class-validator";
import { AIAgentRole } from "@prisma/client";

export class StartConversationDto {
  @IsEnum(AIAgentRole)
  agentRole: AIAgentRole;

  @IsOptional()
  @IsString()
  title?: string;
}
