import { IsString, MaxLength } from "class-validator";

export class SwitchOwnedCompanyDto {
  @IsString()
  @MaxLength(64)
  companyId: string;
}
