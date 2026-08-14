import { Body, Controller, Delete, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PermissionKey } from "@chegowia/shared";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PaginationQueryDto } from "../common/dto/pagination-query.dto";
import { ProductsService } from "./products.service";
import { CreateProductDto, ProductAddonDto, ProductVariationDto, UpdateProductDto } from "./dto/product.dto";
import { CatalogImportService } from "./catalog-import.service";
import { ApplyCatalogImportDto } from "./dto/catalog-import.dto";

@ApiTags("catalog")
@Controller("catalog/products")
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly catalogImportService: CatalogImportService,
  ) {}

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Get("import/template")
  downloadImportTemplate() {
    return new StreamableFile(this.catalogImportService.template(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      disposition: "attachment; filename=modelo-cardapio-chegowia.xlsx",
    });
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post("import/preview")
  @Throttle({ default: { limit: 6, ttl: 60 * 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  previewImport(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @UploadedFile() file: any,
  ) {
    return this.catalogImportService.preview(companyId, userId, file);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post("import/:id/apply")
  applyImport(
    @CurrentUser("companyId") companyId: string,
    @CurrentUser("sub") userId: string,
    @Param("id") id: string,
    @Body() dto: ApplyCatalogImportDto,
  ) {
    return this.catalogImportService.apply(companyId, userId, id, dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_VISUALIZAR)
  @Get()
  list(@Query() query: PaginationQueryDto, @Query("categoryId") categoryId?: string) {
    return this.productsService.list({ ...query, categoryId });
  }

  @RequirePermission(PermissionKey.CARDAPIO_VISUALIZAR)
  @Get(":id")
  findById(@Param("id") id: string) {
    return this.productsService.findById(id);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post(":id/image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadImage(@Param("id") id: string, @UploadedFile() file: any) {
    return this.productsService.uploadImage(id, file);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.productsService.remove(id);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post(":id/variations")
  addVariation(@Param("id") id: string, @Body() dto: ProductVariationDto) {
    return this.productsService.addVariation(id, dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Delete(":id/variations/:variationId")
  removeVariation(@Param("id") id: string, @Param("variationId") variationId: string) {
    return this.productsService.removeVariation(id, variationId);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Post(":id/addons")
  addAddon(@Param("id") id: string, @Body() dto: ProductAddonDto) {
    return this.productsService.addAddon(id, dto);
  }

  @RequirePermission(PermissionKey.CARDAPIO_EDITAR)
  @Delete(":id/addons/:addonId")
  removeAddon(@Param("id") id: string, @Param("addonId") addonId: string) {
    return this.productsService.removeAddon(id, addonId);
  }
}
