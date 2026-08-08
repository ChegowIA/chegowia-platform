import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../common/decorators/public.decorator";
import { CreateDiningOrderDto } from "./dto/create-dining-order.dto";
import { OpenTableDto } from "./dto/open-table.dto";
import { TablesService } from "./tables.service";

/**
 * Superfície deliberadamente pequena para o QR físico da mesa. Ela não recebe
 * JWT, não devolve links internos e não contém rota de fechamento: o QR serve
 * somente para ver o cardápio, iniciar a comanda e enviar rodadas à cozinha.
 */
@ApiTags("tables-public")
@Controller("tables/public")
export class TablesPublicController {
  constructor(private readonly tables: TablesService) {}

  @Public()
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get(":token")
  menu(@Param("token") token: string) {
    return this.tables.getPublicMenu(token);
  }

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post(":token/open")
  open(@Param("token") token: string, @Body() dto: OpenTableDto) {
    return this.tables.openFromQr(token, dto);
  }

  @Public()
  @Throttle({ default: { limit: 24, ttl: 60_000 } })
  order(@Param("token") token: string, @Body() dto: CreateDiningOrderDto) {
    return this.tables.addOrderFromQr(token, dto);
  }
}
