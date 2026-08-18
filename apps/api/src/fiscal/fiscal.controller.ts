import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { FiscalService, MAX_CERTIFICATE_BYTES } from "./fiscal.service";
import { UpdateFiscalProfileDto } from "./dto/update-fiscal-profile.dto";
import { UploadCertificateDto } from "./dto/upload-certificate.dto";

/**
 * Cadastro fiscal da empresa.
 *
 * Nenhuma rota aqui devolve o certificado, a senha dele ou o token do CSC — os
 * segredos só saem da camada de serviço para o emissor de NFC-e. O que a tela
 * recebe é titular, emissor e validade, que é o necessário para o lojista
 * conferir que enviou o arquivo certo e saber quando renovar.
 */
@ApiTags("fiscal")
@Controller("fiscal")
export class FiscalController {
  constructor(private readonly fiscalService: FiscalService) {}

  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get("profile")
  getProfile(@CurrentUser("companyId") companyId: string) {
    return this.fiscalService.getProfile(this.assertCompany(companyId));
  }

  /**
   * Situação fiscal do cardápio. `?pendentes=true` devolve só o que impede a
   * emissão — é a visão útil para quem está preparando o lançamento.
   */
  @RequirePermission(PermissionKey.FISCAL_VISUALIZAR)
  @Get("products")
  listProducts(
    @CurrentUser("companyId") companyId: string,
    @Query("pendentes") pendentes?: string,
  ) {
    return this.fiscalService.listProductTaxStatus(this.assertCompany(companyId), {
      onlyPending: pendentes === "true",
    });
  }

  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Put("profile")
  upsertProfile(
    @CurrentUser("companyId") companyId: string,
    @Body() dto: UpdateFiscalProfileDto,
  ) {
    return this.fiscalService.upsertProfile(this.assertCompany(companyId), dto);
  }

  /**
   * Conversa com a SEFAZ sem emitir nada.
   *
   * É o teste que o lojista pode repetir quantas vezes quiser antes de abrir a
   * loja: prova que o certificado é aceito e que o estado está respondendo,
   * sem gastar numeração.
   */
  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post("sefaz/testar")
  checkSefaz(@CurrentUser("companyId") companyId: string) {
    return this.fiscalService.checkSefaz(this.assertCompany(companyId));
  }

  @RequirePermission(PermissionKey.FISCAL_CONFIGURAR)
  @Post("certificate")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CERTIFICATE_BYTES } }))
  uploadCertificate(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @UploadedFile() file: any,
    @Body() dto: UploadCertificateDto,
  ) {
    return this.fiscalService.uploadCertificate(
      this.assertCompany(companyId),
      userId,
      file,
      dto.password,
    );
  }

  /**
   * SUPER_ADMIN não tem empresa: o cadastro fiscal é sempre da empresa logada,
   * então a rota exige vínculo em vez de operar sobre um tenant indefinido.
   */
  private assertCompany(companyId: string | null) {
    if (!companyId) throw new ForbiddenException("Esta área é do cadastro fiscal da sua empresa.");
    return companyId;
  }
}
