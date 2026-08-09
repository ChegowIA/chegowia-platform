import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import type { Request } from "express";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalJwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { JwtPayload } from "../common/interfaces/jwt-payload.interface";
import { TemporaryTestModeService } from "../common/test-mode/test-mode.service";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { CreateCompanyAdminDto } from "./dto/create-company-admin.dto";
import { UpdateCompanySettingsDto } from "./dto/update-company-settings.dto";

@ApiTags("companies")
@Controller("companies")
export class CompaniesController {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly temporaryTestMode: TemporaryTestModeService,
  ) {}

  // ---- Público (diretório/loja) ----
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get("public")
  publicList(
    @Query("city") city?: string,
    @Query("neighborhood") neighborhood?: string,
    @Query("search") search?: string,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.companiesService.publicList({ city, neighborhood, search }, viewer);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get("public/:slug")
  publicFindBySlug(@Param("slug") slug: string, @CurrentUser() viewer?: JwtPayload) {
    return this.companiesService.publicFindBySlug(slug, viewer);
  }

  // ---- Auto-atendimento do ADMIN da própria empresa ----
  @Roles(Role.ADMIN)
  @Get("me")
  getMyCompany(@CurrentUser("companyId") companyId: string) {
    return this.companiesService.getMyCompany(companyId);
  }

  @Roles(Role.ADMIN)
  @Patch("me")
  updateMyCompany(@CurrentUser("companyId") companyId: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateMyCompany(companyId, dto);
  }

  @Roles(Role.ADMIN)
  @Post("me/logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadMyLogo(@CurrentUser("companyId") companyId: string, @UploadedFile() file: any) {
    return this.companiesService.uploadLogo(companyId, file);
  }

  @Roles(Role.ADMIN)
  @Patch("me/settings")
  updateMySettings(@CurrentUser("companyId") companyId: string, @Body() dto: UpdateCompanySettingsDto) {
    return this.companiesService.updateSettings(companyId, dto);
  }

  // ---- SUPER_ADMIN ----
  @Roles(Role.SUPER_ADMIN)
  @Post()
  create(@Body() dto: CreateCompanyDto, @Req() request: Request) {
    this.temporaryTestMode.assertCreationAllowed(request, "empresa");
    return this.companiesService.create(dto, {
      isTestOnly: this.temporaryTestMode.shouldMarkNewCompanyAsTestOnly(),
    });
  }

  @Roles(Role.SUPER_ADMIN)
  @Get()
  listAll(@Query() query: PaginationQueryDto) {
    return this.companiesService.listAll(query);
  }

  @Roles(Role.SUPER_ADMIN)
  @Get(":id")
  findById(@Param("id") id: string) {
    return this.companiesService.findById(id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post(":id/logo")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadLogo(@Param("id") id: string, @UploadedFile() file: any) {
    return this.companiesService.uploadLogo(id, file);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(":id/status")
  setActive(@Param("id") id: string, @Body("isActive") isActive: boolean) {
    return this.companiesService.setActive(id, isActive);
  }

  @Roles(Role.SUPER_ADMIN)
  @Patch(":id/settings")
  updateSettings(@Param("id") id: string, @Body() dto: UpdateCompanySettingsDto) {
    return this.companiesService.updateSettings(id, dto);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post(":id/admin")
  createAdmin(@Param("id") id: string, @Body() dto: CreateCompanyAdminDto) {
    return this.companiesService.createAdmin(id, dto);
  }
}
