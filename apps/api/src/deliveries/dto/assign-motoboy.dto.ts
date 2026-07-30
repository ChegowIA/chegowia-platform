import { IsString } from "class-validator";

export class AssignMotoboyDto {
  @IsString()
  motoboyId: string;
}
