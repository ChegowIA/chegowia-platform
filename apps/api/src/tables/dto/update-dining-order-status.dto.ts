import { DiningOrderStatus } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UpdateDiningOrderStatusDto {
  @IsEnum(DiningOrderStatus)
  status: DiningOrderStatus;
}
