import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { FiscalDocumentStatus } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { NfceService } from "./nfce.service";
import { CancelDocumentDto, CorrectDocumentDto, EmitDocumentDto, InutilizeRangeDto } from "./dto/nfce.dto";

@ApiTags("fiscal")
@Controller("fiscal/nfce")
export class NfceController {
  constructor(private readonly nfce: NfceService) {}

  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get()
  list(
    @CurrentUser("companyId") companyId: string,
    @Query("status") status?: FiscalDocumentStatus,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.nfce.list(this.assertCompany(companyId), {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get(":id")
  findById(@CurrentUser("companyId") companyId: string, @Param("id") id: string) {
    return this.nfce.findById(this.assertCompany(companyId), id);
  }

  /**
   * Emite a nota de um pedido. Idempotente: chamar de novo devolve a nota
   * existente em vez de emitir outra — um duplo clique no caixa não pode virar
   * duas notas para a mesma venda.
   */
  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post("emitir")
  emit(@CurrentUser("companyId") companyId: string, @Body() dto: EmitDocumentDto) {
    const empresa = this.assertCompany(companyId);
    if (dto.orderId) return this.nfce.emitForOrder(empresa, dto.orderId, { customerDocument: dto.customerDocument });
    return this.nfce.emitForTableSession(empresa, dto.tableSessionId!, { customerDocument: dto.customerDocument });
  }

  /** Reenvio manual do que ficou em contingência. */
  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post(":id/transmitir")
  transmit(@CurrentUser("companyId") companyId: string, @Param("id") id: string) {
    return this.nfce.transmit(this.assertCompany(companyId), id);
  }

  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post(":id/cancelar")
  cancel(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: CancelDocumentDto,
  ) {
    return this.nfce.cancel(this.assertCompany(companyId), id, dto.reason, userId);
  }

  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post(":id/carta-correcao")
  correct(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: CorrectDocumentDto,
  ) {
    return this.nfce.correct(this.assertCompany(companyId), id, dto.correction, userId);
  }

  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post("inutilizar")
  inutilize(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Body() dto: InutilizeRangeDto,
  ) {
    return this.nfce.inutilize(
      this.assertCompany(companyId),
      { start: dto.start, end: dto.end, reason: dto.reason },
      userId,
    );
  }

  /** XML autorizado, para o contador. */
  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get(":id/xml")
  @Header("Content-Type", "application/xml; charset=utf-8")
  async xml(
    @CurrentUser("companyId") companyId: string,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const arquivo = await this.nfce.downloadXml(this.assertCompany(companyId), id);
    res.setHeader("Content-Disposition", `attachment; filename="${arquivo.fileName}"`);
    return arquivo.xml;
  }

  /** Cupom. `?formato=texto` devolve 48 colunas para térmica ESC/POS. */
  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get(":id/danfe")
  async danfe(
    @CurrentUser("companyId") companyId: string,
    @Param("id") id: string,
    @Query("formato") formato: "html" | "texto" = "html",
    @Res({ passthrough: true }) res: Response,
  ) {
    const cupom = await this.nfce.danfe(this.assertCompany(companyId), id, formato);
    res.setHeader("Content-Type", cupom.contentType);
    return cupom.body;
  }

  private assertCompany(companyId: string | null) {
    if (!companyId) throw new ForbiddenException("Esta área é da emissão fiscal da sua empresa.");
    return companyId;
  }
}
