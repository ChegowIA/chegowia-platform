import { LeadStatus } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UpdateLeadStatusDto {
  @IsEnum(LeadStatus)
  status: LeadStatus;
}
