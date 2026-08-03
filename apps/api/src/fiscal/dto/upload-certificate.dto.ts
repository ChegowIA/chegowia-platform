import { IsString, Length } from "class-validator";

export class UploadCertificateDto {
  /** Senha do arquivo .pfx/.p12. Guardada cifrada; nunca volta em resposta. */
  @IsString()
  @Length(1, 200)
  password: string;
}
