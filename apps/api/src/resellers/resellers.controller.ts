import { Body, Controller, Get, Param, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApplicationStatus, Role } from "@prisma/client";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CurrentResellerUser } from "../common/decorators/current-reseller-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { BlockResellerSupportWrite } from "../common/decorators/block-reseller-support-write.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateProspectDto } from "./dto/create-prospect.dto";
import { ResellerApplicationDto } from "./dto/reseller-application.dto";
import { ReviewApplicationDto } from "./dto/review-application.dto";
import { UpdateLeadStatusDto } from "./dto/update-lead-status.dto";
import { ResellerAssistantDto } from "./dto/reseller-assistant.dto";
import { ResellersService } from "./resellers.service";

@ApiTags("resellers")
@Controller("resellers")
export class ResellersController {
  constructor(private readonly service: ResellersService) {}

  @Public()
  @Post("applications")
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @UseInterceptors(FileInterceptor("resume", { limits: { fileSize: 6 * 1024 * 1024 } }))
  apply(@Body() dto: ResellerApplicationDto, @UploadedFile() file: any) {
    return this.service.apply(dto, file);
  }

  @Public()
  @Get("applications/:id/status")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  status(@Param("id") id: string) {
    return this.service.applicationStatus(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/applications")
  applications(@Query("status") status?: ApplicationStatus) {
    return this.service.listApplications(status);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get("admin/applications/:id/resume")
  async resume(@Param("id") id: string) {
    const file = await this.service.resume(id);
    return new StreamableFile(file.buffer, {
      type: file.mime,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }

  @Roles(Role.SUPER_ADMIN)
  @Post("admin/applications/:id/review")
  review(
    @Param("id") id: string,
    @Body() dto: ReviewApplicationDto,
    @CurrentUser("sub") reviewerId: string,
  ) {
    return this.service.humanReview(id, dto.approve, dto.notes, reviewerId);
  }

  /**
   * Diretório operacional separado das candidaturas. Inclui perfis inativos
   * para que o suporte possa diagnosticar contas reais que já não entram no
   * fluxo comercial normal.
   */
  @Roles(Role.SUPER_ADMIN)
  @Get("admin/profiles")
  profiles(@Query() query: PaginationQueryDto) {
    return this.service.listProfiles(query);
  }

  @Roles(Role.REVENDEDOR)
  @Get("me/dashboard")
  dashboard(@CurrentResellerUser() userId: string, @CurrentUser() identity: JwtPayload) {
    const supportView = this.isSupportView(identity);
    return this.service.dashboard(userId, supportView, supportView);
  }

  @Roles(Role.REVENDEDOR)
  @Get("me/prospects")
  prospects(@CurrentResellerUser() userId: string, @CurrentUser() identity: JwtPayload) {
    return this.service.listProspects(userId, this.isSupportView(identity));
  }

  @Roles(Role.REVENDEDOR)
  @Post("me/prospects")
  @BlockResellerSupportWrite()
  createProspect(@CurrentResellerUser() userId: string, @Body() dto: CreateProspectDto) {
    return this.service.createProspect(userId, dto);
  }

  @Roles(Role.REVENDEDOR)
  @Get("me/leads")
  leads(@CurrentResellerUser() userId: string, @CurrentUser() identity: JwtPayload) {
    const supportView = this.isSupportView(identity);
    // A visão de suporte mostra apenas a carteira do parceiro escolhido. Ela
    // não deve virar uma janela para a fila global de oportunidades nem entrar
    // na disputa ao vivo entre revendedores.
    return this.service.availableLeads(userId, supportView, supportView);
  }

  @Roles(Role.REVENDEDOR)
  @Post("me/leads/:id/claim")
  @BlockResellerSupportWrite()
  claim(@CurrentResellerUser() userId: string, @Param("id") id: string) {
    return this.service.claimLead(userId, id);
  }

  @Roles(Role.REVENDEDOR)
  @Post("me/leads/:id/status")
  @BlockResellerSupportWrite()
  updateLeadStatus(@CurrentResellerUser() userId: string, @Param("id") id: string, @Body() dto: UpdateLeadStatusDto) {
    return this.service.updateLeadStatus(userId, id, dto.status);
  }

  @Roles(Role.REVENDEDOR)
  @Post("me/assistant")
  @BlockResellerSupportWrite()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  assistant(@CurrentResellerUser() userId: string, @Body() dto: ResellerAssistantDto) {
    return this.service.assistant(userId, dto.message);
  }

  private isSupportView(identity: JwtPayload) {
    return Boolean(identity.assumed && identity.assumedAccessId && identity.assumedAccessKind === "RESELLER");
  }

  @Public()
  @Post("leads")
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  createLead(@Body() dto: CreateLeadDto) {
    return this.service.createLead(dto);
  }
}
