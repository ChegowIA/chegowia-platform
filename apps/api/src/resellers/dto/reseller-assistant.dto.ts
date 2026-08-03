import { IsString, MaxLength, MinLength } from "class-validator";

export class ResellerAssistantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1200)
  message!: string;
}
