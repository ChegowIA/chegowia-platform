import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../decorators/public.decorator";
import { ReportClientErrorDto } from "./report-client-error.dto";
import { relatarErro } from "./error-reporting";

/**
 * Erros de tela chegam pela nossa API, não direto para o serviço externo.
 *
 * Assim a chave do serviço não vai para o navegador, a política de conteúdo da
 * página não precisa liberar um host novo, e a limpeza de dado sensível continua
 * acontecendo em um único lugar — o mesmo por onde passam os erros do servidor.
 */
@ApiTags("observability")
@Controller("observability")
export class ObservabilityController {
  @Public()
  @Post("client-error")
  @HttpCode(HttpStatus.NO_CONTENT)
  // Tela quebrada em laço de renderização mandaria centenas de relatos por
  // minuto. O limite corta o excesso sem perder o primeiro, que é o que importa.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reportClientError(@Body() dto: ReportClientErrorDto) {
    const erro = new Error(dto.message);
    erro.name = "ErroNaTela";
    if (dto.stack) erro.stack = `${erro.name}: ${dto.message}\n${dto.stack}`;
    relatarErro(erro, {
      origem: "web",
      rota: dto.path,
      requestId: dto.digest,
    });
  }
}
