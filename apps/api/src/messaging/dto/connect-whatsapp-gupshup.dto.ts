import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator";

/**
 * Conexão manual usada no modo self-serve do Gupshup, onde não existe API para
 * criar o app por cliente. O superadmin cria o app no painel do Gupshup e traz
 * aqui as três informações que o sistema precisa; o link é o que o empresário
 * abre para concluir o cadastro com o Facebook dele.
 */
export class ConnectWhatsAppGupshupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "O nome do aplicativo do Gupshup aceita apenas letras, números, hífen e underscore.",
  })
  appName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  appId?: string;

  /** URL do passo "Direct Facebook Registration" gerada no painel do Gupshup. */
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: "O link de conexão precisa começar com https://." })
  @MaxLength(1024)
  signupLink?: string;

  /** Preenchido quando o número já concluiu o cadastro no Gupshup. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string;
}
