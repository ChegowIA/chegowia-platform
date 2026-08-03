import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CashSessionStatus } from "@prisma/client";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { CashService } from "./cash.service";
import {
  CashMovementDto,
  CloseCashSessionDto,
  CreateCashRegisterDto,
  OpenCashSessionDto,
  UpdateCashRegisterDto,
} from "./dto/cash.dto";

@ApiTags("caixa")
@Controller("caixa")
export class CashController {
  constructor(private readonly cash: CashService) {}

  @RequirePermission(PermissionKey.CAIXA_VISUALIZAR)
  @Get("pontos")
  listRegisters(@CurrentUser("companyId") companyId: string) {
    return this.cash.listRegisters(this.assertCompany(companyId));
  }

  @RequirePermission(PermissionKey.CAIXA_GERENCIAR)
  @Post("pontos")
  createRegister(@CurrentUser("companyId") companyId: string, @Body() dto: CreateCashRegisterDto) {
    return this.cash.createRegister(this.assertCompany(companyId), dto.name);
  }

  @RequirePermission(PermissionKey.CAIXA_GERENCIAR)
  @Patch("pontos/:id")
  updateRegister(
    @CurrentUser("companyId") companyId: string,
    @Param("id") id: string,
    @Body() dto: UpdateCashRegisterDto,
  ) {
    return this.cash.updateRegister(this.assertCompany(companyId), id, dto);
  }

  @RequirePermission(PermissionKey.CAIXA_OPERAR)
  @Post("turnos")
  open(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Body() dto: OpenCashSessionDto,
  ) {
    return this.cash.openSession(this.assertCompany(companyId), userId, dto);
  }

  @RequirePermission(PermissionKey.CAIXA_VISUALIZAR)
  @Get("turnos")
  listSessions(
    @CurrentUser("companyId") companyId: string,
    @Query("cashRegisterId") cashRegisterId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: CashSessionStatus,
  ) {
    return this.cash.listSessions(this.assertCompany(companyId), {
      cashRegisterId,
      status,
      from: from ? new Date(from) : undefined,
      // O filtro é por dia; somar 24h faz o `lt` cobrir o dia inteiro escolhido.
      to: to ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000) : undefined,
    });
  }

  @RequirePermission(PermissionKey.CAIXA_VISUALIZAR)
  @Get("turnos/atual")
  current(@CurrentUser("companyId") companyId: string, @Query("cashRegisterId") cashRegisterId: string) {
    return this.cash.currentSession(this.assertCompany(companyId), cashRegisterId);
  }

  @RequirePermission(PermissionKey.CAIXA_VISUALIZAR)
  @Get("turnos/:id")
  report(@CurrentUser("companyId") companyId: string, @Param("id") id: string) {
    return this.cash.report(this.assertCompany(companyId), id);
  }

  @RequirePermission(PermissionKey.CAIXA_OPERAR)
  @Post("turnos/:id/movimentos")
  addMovement(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: CashMovementDto,
  ) {
    return this.cash.addMovement(this.assertCompany(companyId), userId, id, dto);
  }

  @RequirePermission(PermissionKey.CAIXA_OPERAR)
  @Post("turnos/:id/fechar")
  close(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: CloseCashSessionDto,
  ) {
    return this.cash.closeSession(this.assertCompany(companyId), userId, id, dto);
  }

  private assertCompany(companyId: string | null) {
    if (!companyId) throw new ForbiddenException("Esta área é do caixa da sua empresa.");
    return companyId;
  }
}
