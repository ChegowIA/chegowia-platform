import { IsString, MaxLength, MinLength } from "class-validator";

/** Conferência da lista antes de criar o disparo. */
export class AnalyzeOutreachListDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  contacts!: string;
}
